import { parse } from "ini";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";
import * as proc from "child_process"

import { Config } from ".";
import { EventOccurrence, IwpoEvent } from "./IwpoEvent";
import { ServerPackage } from "./ServerPackage";
import { Helper } from "./Helper";
import { Server } from "./Server";
import { glob } from "glob";

// TODO: add the various extension files (font_online vs font_online8 etc) to the corresponding "don't copy" lists
const GMS_FILES: string[] = [ // Files/directories that are GMS specific and don't need to be copied if the game isn't GMS
    'converterGMS.exe', 'GMS', 'http_dll_2_3_x64.dll'
];
const GM8_FILES: string[] = [ // Files/directories that are GM8 specific and don't need to be copied if the game is GMS
    'gml'
]
const SKIP_FILES: string[] = [ // Files/directories that can always be skipped
    'mac', 'tmp',
]

enum TestState {
    WAITING,
    READ,
    INITIALIZED,
    PASSED,
    FAILED
}
function string_array(input: any): string[] {
    if (Array.isArray(input)) {
        return input;
    }
    throw new Error(`'${input}' was not an array`);
}
function string(input: any): string {
    if (typeof input !== 'string') {
        return input.toString();
    }
    return input;
}
function bool(input: any): boolean {
    if (typeof input === 'boolean') {
        return input;
    }
    throw new Error(`'${input}' was not a boolean`);
}
function number(input: any): number {
    const value = Number(input);
    if (Number.isNaN(value) === false) {
        return value;
    }
    throw new Error(`'${input}' could not be parsed as a number`);
}
export class Test {
    name: string;

    config: Config;
    folder: string;
    game: string;
    args: string[];
    output: string;
    timeout: number;
    iwpo_timeout: number;
    is_gms: boolean;
    skip_execute: boolean;
    expected_error: string[];

    tcp_port: number;
    udp_port: number;

    events: Array<IwpoEvent>;
    packages: Array<ServerPackage>;

    status: TestState;
    message_log: Array<string>;

    temp_dir: string;
    output_resolved: string;
    log_file: string;
    result_file: string;

    server: Server;

    public constructor(config: Config, name: string) {
        this.config = config;
        this.name = name;

        this.message_log = new Array<string>();

        this.tcp_port = Helper.getPort();
        this.udp_port = Helper.getPort();

        this.status = TestState.WAITING;
    }

    public serialize_packets(): any {
        const map = {};
        for (const packet of this.packages) {
            map[packet.name] = packet.serialize();
        }
        return map;
    }

    public passed(): boolean {
        return this.status === TestState.PASSED;
    }
    public can_execute(): boolean {
        return this.status !== TestState.FAILED && this.status !== TestState.PASSED;
    }
    public testResult(): string {
        if (this.passed())
            return this.format('PASSED');
        return this.format('FAILED');
    }

    public async readFromFile(file: string): Promise<void> {
        await this._setState(TestState.WAITING, async () => { await this._readFromFile(file); return TestState.READ; });
    }
    public async readFromDefaultExe(file: string) {
        await this._setState(TestState.WAITING, async () => { await this._fromExe(file); return TestState.READ; });
    }
    public async Initialize(): Promise<void> {
        await this._setState(TestState.READ, async () => { await this._initialize(); return TestState.INITIALIZED; });
    }
    public async Run(): Promise<void> {
        await this._setState(TestState.INITIALIZED, async () => { return await this._run(); });
    }
    public async Clean(): Promise<void> {
        await this._setState(this.status, async () => { await this._clean(); return this.status; });
    }

    private async _setState(expected: TestState, fn: () => Promise<TestState>): Promise<void> {
        try
        {
            if (this.status !== expected) throw new Error(`Test is in invalid state '${TestState[this.status]}'. Expected: '${TestState[expected]}'`);
            this.status = await fn();
        }
        catch (e)
        {
            this.status = TestState.FAILED;
            const msg = e.message ?? e;
            this.log_verbose(msg);
        }
    }
    private async _readFromFile(filename: string): Promise<void> {
        const fileContents = (await readFile(filename, 'utf-8')).split('[events]');
    
        if (fileContents.length == 0 || fileContents.length > 2) throw new Error(`Multiple [events] sections found in '${filename}'`);
    
        const ini = parse(fileContents[0]);
        const self = this;
    
        function getValue(prop: string): any | undefined {
            let value = ini;
            for (const section of prop.split('.')) {
                value = value[section];
                if (value === undefined) {
                    return undefined;
                }
            }
            return value;
        }
        function required<T>(prop: string, convertFn: (input: any) => T): T {
            const value = getValue(prop);
            if (value === undefined) {
                throw new Error(`Required key '${prop}' is missing in '${filename}'`);
            }
    
            return convertFn(value);
        }
        function optional<T>(prop: string, convertFn: (input: any) => T, defaultValue: T): T {
            const value = getValue(prop);
            if (value === undefined) {
                self.log_verbose(`Using default value '${defaultValue}' for key '${prop}' in '${filename}'`);
                return defaultValue;
            }
    
            return convertFn(value);
        }
    
        // Required settings
        this.folder = required('configuration.folder', string);
        this.game = required('configuration.game', string);
        this.output = required('configuration.output', string);
        this.is_gms = required('configuration.is_gms', bool);
        
        // Optional settings
        this.name = optional('configuration.name', string, this.name);
        this.args = optional('configuration.args', string_array, []);
        this.timeout = optional('configuration.timeout', number, 30);
        this.iwpo_timeout = optional('configuration.iwpo_timeout', number, 20);
        this.skip_execute = optional('configuration.skip_execute', bool, false);
        this.expected_error = optional('configuration.expected_error', string_array, null);
        
        // Resolve directories to absolute paths relative to this file
        this.folder = path.resolve(path.dirname(filename), this.folder);
    
        this.packages = new Array<ServerPackage>;
        if (ini.server_packages !== undefined) {
            for (const packet in ini.server_packages) {
                if (this.packages.findIndex(pack => pack.name == packet) >= 0)
                    throw new Error(`Server package '${packet}' is already defined`);
                this.packages.push(new ServerPackage(packet, ini.server_packages[packet]));
            }
        }

        this.events = IwpoEvent.defaultEvents(this);
        if (fileContents.length > 1) {
            const matches = [...fileContents[1].matchAll(/^\$\$(?<condition>pre|post|test|script)_(?<filename>\w*?)\s*?$/gms)];
            for (let i = 0; i < matches.length; i++) {
                const match = matches[i];

                const start_index = match.index+match[0].length;
                const end_index = matches[i+1]?.index ?? fileContents[1].length;
                const gml = fileContents[1].substring(start_index, end_index).trim();

                let event = this.events.find(ev => ev.file === match.groups.filename);
                if (event === undefined) {
                    event = new IwpoEvent(match.groups.filename, this)
                    this.events.push(event);
                }
                await event.setGml(match.groups.condition, gml);
            }
        }
    }
    private async _fromExe(filename: string): Promise<void> {
        this.folder = path.dirname(filename);
        this.game = path.basename(filename);
        this.output = undefined;
        this.is_gms = false; // TODO
        
        // Optional settings
        this.args = ['--external-dll', '--no-foxwriting']; // These should never hurt to apply
        this.timeout = 30;
        this.iwpo_timeout = 20;
        this.skip_execute = false;
        this.expected_error = null;

        // Resolve directories to absolute paths relative to this file
        this.folder = path.resolve(path.dirname(filename), this.folder);

        this.packages = new Array<ServerPackage>;
        this.packages.push(new ServerPackage('CHAT', 'TCP 04 "test message"'));

        const ev_begin = new IwpoEvent('worldCreate', this);
        await ev_begin.setGml('pre', `
@name="Test";
@password="";
@race=false;
`.trim());
        const ev_end = new IwpoEvent('worldEndStep', this);
        await ev_end.setGml('pre', `
@pX = 32;
@pY = 32;
@pExists = true;
@stoppedFrames = 10;
instance_create(@pX,@pY,%arg0);
@TEST_SEND_CHAT=true;
@TEST_MESSAGE="test message";
@SERVER_EXPECT("CHAT");
`.trim());
        await ev_end.setGml('post', `@PASS();`);
        this.events = new Array<IwpoEvent>(...IwpoEvent.defaultEvents(this), ev_begin, ev_end);
    }
    private async _initialize(): Promise<void> {
        this.temp_dir = path.join(this.config.temp_folder_resolved, randomUUID());

        if (this.output !== undefined)
            this.output_resolved = path.resolve(this.temp_dir, this.output);

        this.log_file = path.resolve(this.temp_dir, 'game_errors.log');
        this.result_file = path.resolve(this.temp_dir, 'result.txt');
        
        this.log_verbose(`Copying '${this.folder}' to new temp directory '${this.temp_dir}'`);
        await fs.cp(this.folder, this.temp_dir, { recursive: true });
    }
    private async _run(): Promise<TestState> {
        const result = await this.runIwpo();

        this.log_verbose(result.out);
        if (result.err !== '') {
            this.log_verbose(result.err);
        }

        if (this.output_resolved === undefined) {
            this.output_resolved = await (async (): Promise<string> => {
                let file = this.temp_dir + '\\' + this.game.substring(0, this.game.length-4) + '_online.exe';

                if (await Helper.pathExists(file)) {
                    return file;
                }

                // TODO: test these bottom two conditions
                file = file.substring(0, file.length-4) + '/';
                if (await Helper.pathExists(file)) {
                    let result = await glob(file+'*.exe', { absolute: true });
                    if (result.length != 1) {
                        this.log_verbose(`Cannot determine exe file. ${result.length} potential exe files found`);
                        return undefined;
                    } else {
                        return result[0];
                    }
                }

                file = path.basename(file) + 'data_backup.win';
                if (await Helper.pathExists(file)) {
                    return this.temp_dir + '\\' + this.game;
                }

                return undefined;
            })();

            if (this.output_resolved === undefined) {
                return this.fail(`Output could not be determined for game. TODO: implement GMS and zipped GMS and also installer enabled GM8`);
            }
        } else if (!await Helper.pathExists(this.output_resolved)) {
            return this.fail(`Output file '${this.output}' did not exist`);
        }

        if (this.skip_execute) {
            return TestState.PASSED;
        }

        return await this._execute();
    }
    private async _execute(): Promise<TestState> {
        this.server = new Server(this);

        await this.server.start();
        await Helper.exec(this.output_resolved, this.temp_dir, this.config.verbose, this.timeout);
        await this.server.stop();

        this.log_verbose(this.server.stdout);
        this.log_verbose(this.server.stderr);
        
        if (await Helper.pathExists(this.log_file)) {
            const fileContent = await fs.readFile(this.log_file, { encoding: 'utf-8' });
            this.log_verbose(fileContent);

            if (this.expected_error !== null && this.expected_error.join('\n').trim() != fileContent.trim().replace(/\r\n/g, '\n')) {
                return this.fail(`game_errors.log differed from expected error`);
            } else {
                this.log_verbose('errors ok');
            }
        } else if (this.expected_error != null) {
            this.log_verbose(`Log file '${this.log_file}' was not found`);
            return this.fail(`game_errors.log was expected but not created.`);
        }

        if (!await Helper.pathExists(this.result_file)) {
            this.log_verbose(`'${this.result_file}' does not exist`);
            return this.fail('Result file was not created');
        }

        const fileContent = await fs.readFile(this.result_file, { encoding: 'utf-8' });
        if (fileContent !== 'ok') {
            this.log_verbose('Test failed with status: ' + fileContent);
            return this.fail(fileContent);
        }

        if (!this.server.ok()) {
            return this.fail(this.server.message);
        }

        return TestState.PASSED;
    }
    private async _clean(): Promise<void> {
        if (this.server !== undefined) {
            this.server.kill();
        }

        if (this.config.keep === false) {
            if (this.temp_dir.length != 0) {
                this.log_verbose(`Cleaning temp directory '${this.temp_dir}'`);
                await fs.rm(this.temp_dir, { recursive: true });
            } else {
                console.warn('Temp directory is not set');
            }
        }
    }

    private fail(msg: string): TestState {
        this.log_verbose(msg);
        return TestState.FAILED;
    }

    public log_verbose(msg: string | Array<string>) {
        if (Array.isArray(msg)) {
            for (const message of msg) {
                this.log_verbose(message);
            }
            return;
        }

        this.message_log.push(msg);
        if (this.config.verbose && msg !== '') {
            console.log(this.format(msg));
        }
    }

    public format(msg: string) {
        return `[${this.name}] ${msg.split(/[\r\n]/g).join('\n>> ')}`;
    }

    private getScripts(): object {
        const scripts = {};
        for (const event of this.events) {
            const gml = event.gml.get(EventOccurrence.script);
            if (gml !== undefined) {
                scripts[event.file] = gml;
            }
        }
        return scripts;
    }
    private getModifications(): object {
        const mods = {};
        for (const event of this.events) {
            if (event.gml.has(EventOccurrence.pre)) {
                mods['pre_' + event.file] = event.gml.get(EventOccurrence.pre);
            }
            if (event.gml.has(EventOccurrence.post)) {
                mods['post_' + event.file] = event.gml.get(EventOccurrence.post);
            }
        }
        return mods;
    }

    private runIwpo(): Promise<{ out: string; err: string; }> {
        return new Promise((resolve, reject) => {
            try {
                const std = {
                    out: '',
                    err: '',
                };
                const args = [
                    path.resolve(this.temp_dir, this.game),
                    ...this.args,
                    '--test-suite',
                    `server=${this.config.test_server},${this.tcp_port},${this.udp_port}`,
                ];
                this.log_verbose(`Running iwpo with args "${args.join('" "')}"`);
                const process = proc.fork(path.resolve(this.config.iwpo_data, 'index.js'), args,
                    // Options
                    {
                        cwd: this.temp_dir,
                        timeout: this.iwpo_timeout*1000,
                        silent: true,
                        execArgv: ['--max_old_space_size=8192'],
                        env: {},
                    }
                );
                process.stdout.on('data', ((msg: string) => { std.out += msg.toString(); }).bind(this));
                process.stderr.on('data', ((msg: string) => { std.err += msg.toString(); }).bind(this));
                process.on('exit', () => {
                    resolve(std);
                });
                process.on('error', reject);
                process.send({
                    name: 'run',
                    config: this.config.simplified(),
                    scripts: this.getScripts(),
                    modifications: this.getModifications(),
                });
            } catch (e) {
                reject(e);
            }
        });
    }
}

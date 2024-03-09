import { parse } from "ini";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs/promises";

import { Config } from ".";
import { IwpoEvent } from "./IwpoEvent";
import { ServerPackage } from "./ServerPackage";

// TODO: add the various extension files (font_online vs font_online8 etc) to the corresponding "don't copy" lists
const GMS_FILES: string[] = [ // Files/directories that are GMS specific and don't need to be copied if the game isn't GMS
    'converterGMS.exe', 'GMS', 'http_dll_2_3_x64.dll'
];
const GM8_FILES: string[] = [ // Files/directories that are GM8 specific and don't need to be copied if the game is GMS
    'gml'
]
const SKIP_FILES: string[] = [ // Files/directories that can always be skipped
    'mac', 'tmp'
]

enum TestState {
    WAITING,
    READ,
    INITIALIZED,
    PASSED,
    FAILED
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
    args: string;
    output: string;
    timeout: number;
    is_gms: boolean;
    skip_execute: boolean;

    events: Array<IwpoEvent>;
    packages: Array<ServerPackage>;

    status: TestState;
    message: string;

    log: Array<string>;

    temp_dir: string;

    public constructor(config: Config, name: string) {
        this.config = config;
        this.message = '';
        this.log = new Array<string>;
        this.name = name;

        this.status = TestState.WAITING;
    }

    public passed(): boolean {
        return this.status === TestState.PASSED;
    }
    public can_execute(): boolean {
        return this.status !== TestState.FAILED && this.status !== TestState.PASSED;
    }
    public testResult(): string {
        let message = `[${this.folder}/${this.game}] `;
        if (this.passed()) {
            message += 'PASSED';
        } else {
            message += 'FAILED';
        }

        if (this.message !== undefined) {
            message += ' - '
            message += this.message;
        }

        if (this.config.verbose) {
            message += '\n' + this.log.join('\n');
        }

        return message;
    }

    public async readFromFile(file: string): Promise<void> {
        await this._setState(TestState.WAITING, async () => { await this._readFromFile(file); return TestState.READ; });
    }
    public async Initialize(): Promise<void> {
        await this._setState(TestState.READ, async () => { await this._initialize(); return TestState.INITIALIZED; });
    }
    public async Run(): Promise<void> {
        await this._setState(TestState.INITIALIZED, this._run);
    }
    public async Clean(): Promise<void> {
        await this._setState(this.status, async () => { await this._clean(); return this.status; });
    }

    private async _setState(expected: TestState, fn: () => Promise<TestState>): Promise<void> {
        try
        {
            if (this.status != expected) throw new Error(`Test is in invalid state '${this.status}'. Expected: '${expected}'`);
            this.status = await fn();
        }
        catch (e)
        {
            this.status = TestState.FAILED;
            this.log.push(e.message);
            this.message = e.message;
        }
    }
    private async _readFromFile(filename: string): Promise<void> {
        const fileContents = (await readFile(filename, 'utf-8')).split('[events]');
    
        if (fileContents.length == 0 || fileContents.length > 2) throw new Error(`Multiple [events] sections found in '${filename}'`);
    
        const ini = parse(fileContents[0]);
        const config = this.config;
    
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
                if (config.verbose)
                    console.log(`Using default value '${defaultValue}' for key '${prop}' in '${filename}'`);
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
        this.args = optional('configuration.arguments', string, '');
        this.timeout = optional('configuration.timeout', number, 60);
        this.skip_execute = optional('configuration.skip_execute', bool, false);
        this.name = optional('configuration.name', string, this.name);

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
        this.events = new Array<IwpoEvent>;
        if (fileContents.length > 1) {
            const matches = [...fileContents[1].matchAll(/^\$\$(?<condition>pre|post|test)_(?<filename>\w*?)\s*?$/gms)];
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
    private async _initialize(): Promise<void> {
        this.temp_dir = path.join(this.config.temp_folder_resolved, randomUUID());
        
        this.log_verbose(`Copying '${this.folder}' to new temp directory '${this.temp_dir}'`);
        await fs.cp(this.folder, this.temp_dir, { recursive: true });

        this.log_verbose(`Copying iwpo.exe and data directory`);
        await fs.cp(this.config.iwpo_exe, path.join(this.temp_dir, 'iwpo.exe'));
        await fs.cp(this.config.iwpo_data, path.join(this.temp_dir, 'data'), { recursive: true, filter(source, _destination) {
            const name = path.basename(source);
            if (SKIP_FILES.indexOf(name) >= 0) return false;
            if (this.is_gms) {
                if (GM8_FILES.indexOf(name) >= 0) return false;
            } else {
                if (GMS_FILES.indexOf(name) >= 0) return false;
            }
            return true;
        }, });

        this.log_verbose(`Modifying iwpo files`);
        for (const event of this.events) {
            await event.Initialize();
        }
    }
    private async _run(): Promise<TestState> {
        throw new Error("Method _run not implemented.");
    }
    private async _clean(): Promise<void> {
        if (this.config.keep === false) {
            if (this.temp_dir.length != 0) {
                await fs.rm(this.temp_dir, { recursive: true });
            } else {
                console.warn('Temp directory is empty');
            }
        }
    }

    private log_verbose(msg: string) {
        if (this.config.verbose) {
            console.log(`[${this.name}] ${msg}`);
        }
    }
}

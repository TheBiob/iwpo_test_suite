import { parse } from "ini";
import { readFile } from "fs/promises";
import { Config } from ".";
import { IwpoEvent } from "./IwpoEvent";
import { ServerPackage } from "./ServerPackage";

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
    config: Config;
    folder: string;
    game: string;
    args: string;
    output: string;
    timeout: number;
    is_gms: boolean;
    skip_execute: boolean;

    events: Map<string, IwpoEvent>;
    packages: Map<string, ServerPackage>;

    status: TestState;
    message: string;

    log: Array<string>;

    temp_dir: string;

    public constructor(config: Config) {
        this.config = config;
        this.message = '';
        this.log = new Array<string>;

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
        throw new Error("Method Clean not implemented.");
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
                if (this.config.verbose)
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
    
        this.packages = new Map<string, ServerPackage>;
        
        if (ini.server_packages !== undefined) {
            for (const packet in ini.server_packages) {
                this.packages.set(packet, new ServerPackage(ini.server_packages[packet]));
            }
        }
        
        this.events = new Map<string, IwpoEvent>;
        if (fileContents.length > 1) {
            const matches = [...fileContents[1].matchAll(/^\$\$(?<condition>pre|post|test)_(?<filename>\w*?)\s*?$/gms)];
            for (let i = 0; i < matches.length; i++) {
                const match = matches[i];
                if (this.events.has(match[0])) {
                    throw new Error(`Event '${match[0]}' already exists in '${filename}'`);
                }
    
                const start_index = match.index+match[0].length;
                const end_index = matches[i+1]?.index ?? fileContents[1].length;
                const event = new IwpoEvent(match.groups.condition, match.groups.filename, fileContents[1].substring(start_index, end_index).trim(), this)
                await event.checkFile();
                this.events.set(match[0], event);
            }
        }
    }
    private async _initialize(): Promise<void> {
        throw new Error("Method _initialize not implemented.");
    }
    private async _run(): Promise<TestState> {
        throw new Error("Method _run not implemented.");
    }
}

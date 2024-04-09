import { glob } from "glob";
import process from "process";
import path from "path";
import fs from "fs/promises";

import { Helper } from "./Helper";
import { RunIwpoTests } from "./run_tests";

export class Config {
    files: Array<string>;
    verbose: boolean;
    keep: boolean;
    max_parallel: number;
    help: boolean;

    iwpo_base_folder: string;
    temp_folder: string;
    server_js: string;

    test_server: string;

    // Variables will be resolved by ResolveFiles and contain the absolute paths to the relevant resources
    resolved_files: Array<string>;
    iwpo_exe: string;
    iwpo_data: string;
    server_js_resolved: string;
    temp_folder_resolved: string;

    public constructor() {
        this.resolved_files = [];
        this.files = [];
        this.verbose = false;
        this.keep = false;
        this.max_parallel = 1;
        this.help = false;
        this.iwpo_base_folder = undefined;
        this.temp_folder = undefined;
        this.test_server = '127.0.0.1'; // Currently not configurable from the CLI. Not sure if that'd be useful.
    }

    public simplified(): object {
        return {
            keep: this.keep,
            verbose: this.verbose,
        }
    }

    /**
     * Reads this.files and creates a list of actual test files in this.resolved_files
     */
    public async ResolveFiles(): Promise<void> {
        for (let fileGlob of this.files) {
            const files = await glob(fileGlob);

            if (files.length == 0) {
                console.warn(`Warning: ${fileGlob} does not match any files`);
                continue;
            }

            for (let file of files) {
                if (!(file in this.resolved_files))
                    this.resolved_files.push(path.resolve(file));
            }
        }

        this.iwpo_exe = path.resolve(path.join(this.iwpo_base_folder, 'iwpo.exe'));
        this.iwpo_data = path.resolve(path.join(this.iwpo_base_folder, 'data'));
        this.server_js_resolved = path.resolve(this.server_js);
        this.temp_folder_resolved = path.resolve(this.temp_folder);
    };
}

const ParseConfig = async function(args: Array<string>): Promise<Config> {
    let config: Config = new Config();

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        switch (arg) {
            case '-h':
            case '--help':
                config.help = true;
                return config;
            case '--file':
                if (i == args.length-1) {
                    console.log('Missing file argument to --file');
                    config.help = true;
                } else {
                    i++;
                    const file = args[i];
                    if (!(file in config.files)) {
                        config.files.push(file);
                    }
                }
                break;
            case '--iwpo-dir':
                if (i == args.length-1) {
                    console.log('Missing directory argument to --iwpo-dir');
                    config.help = true;
                } else if (config.iwpo_base_folder !== undefined) {
                    console.log('--iwpo-dir has already been configured');
                    config.help = true;
                } else {
                    i++;
                    config.iwpo_base_folder = args[i];
                }
                break;
            case '--temp-dir':
                if (i == args.length-1) {
                    console.log('Missing directory argument to --temp-dir');
                    config.help = true;
                } else if (config.temp_folder !== undefined) {
                    console.log('--temp-dir has already been configured');
                    config.help = true;
                } else {
                    i++;
                    config.temp_folder = args[i];
                }
                break;
            case '--server-script':
                if (i == args.length-1) {
                    console.log('Missing file argument to --server-script');
                    config.help = true;
                } else if (config.server_js !== undefined) {
                    console.log('--server-script has already been configured');
                    config.help = true;
                } else {
                    i++;
                    config.server_js = args[i];
                }
                break;
            case '--max-parallel':
                if (i == args.length-1) {
                    console.log('Missing count argument to --max-parallel');
                    config.help = true;
                } else {
                    i++;
                    const num = Number(args[i]);
                    if (!Number.isInteger(num) || Number.isNaN(num) || num < 0) {
                        console.log(`Invalid number ${args[i]}. --max-parallel must be a positive finite integer or 0 for unlimited`);
                    } else {
                        config.max_parallel = num;
                    }
                }
                break;
            case '-k':
            case '--keep':
                config.keep = true;
                break;
            case '-v':
            case '--verbose':
                config.verbose = true;
                break;
        }
    }

    config.iwpo_base_folder = config.iwpo_base_folder ?? 'iwpo/';
    config.temp_folder = config.temp_folder ?? 'temp/';
    config.server_js = config.server_js ?? 'iwpo/server.js';

    return config;
}

const PrintHelp = async function() {
    console.log(`iwpotest.js [args]
--help, -h             - Prints this help
--file <file>          - Which test file(s) to read and execute. Can be used multiple times and also supports wildcards like *.iwpotest. If a file is specified multiple times, it will only be run once.
--server-script <file> - Sets the server script file to copy and start. Default: iwpo/server.js
--iwpo-base-dir <dir>  - Sets the Iwpo directory to be copied and modified. Default: iwpo/ 
--temp-dir <dir>       - Sets the temporary directory to copy to. Default: temp/
--max-parallel <count> - Sets how many tests are allowed to run in parallel. 0 means unlimited. Default: 1
--keep, -k             - Keeps generated temporary directories
--verbose, -v          - Enables verbose logging
`);
}

const main = async function(): Promise<number> {
    const config: Config = await ParseConfig(process.argv);

    if (config.help) {
        PrintHelp();
        return 0;
    }

    await config.ResolveFiles();

    if (config.resolved_files.length == 0) {
        console.log('No test files found');
        return 0;
    }

    if (!await Helper.pathExists(config.iwpo_exe)) {
        console.log(`'${config.iwpo_exe}' does not exist`);
        return 0;
    }
    if (!await Helper.pathExists(config.iwpo_data)) {
        console.log(`'${config.iwpo_data}' does not exist`);
        return 0;
    }
    if (!await Helper.pathExists(config.temp_folder_resolved)) {
        if (config.verbose)
            console.log(`Creating temp directory '${config.temp_folder_resolved}'`);
        await fs.mkdir(config.temp_folder_resolved);
    }

    console.time('run_iwpo_tests');
    
    console.log(`Found ${config.resolved_files.length} test(s)`);
    const all_passed = await RunIwpoTests(config);

    console.timeEnd('run_iwpo_tests');

    return all_passed ? 0 : 1;
}

main()
.then(() => {})
.catch(err => console.log(err));

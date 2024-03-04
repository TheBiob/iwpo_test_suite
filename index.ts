import { glob } from "glob";
import process from "process";

class Config {
    files: Array<string>;
    verbose: boolean;
    keep: boolean;
    help: boolean;

    resolved_files: Array<string>;

    public constructor() {
        this.resolved_files = [];
        this.files = [];
        this.verbose = false;
        this.keep = false;
        this.help = false;
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
                    this.resolved_files.push(file);
            }
        }
    };
}

const ParseConfig = async function(args: Array<string>): Promise<Config> {
    let config: Config = new Config();

    let expect_file: boolean = false;
    for (let arg of args) {
        if (expect_file) {
            if (!(arg in config.files)) {
                config.files.push(arg);
            }
            expect_file = false;
            continue;
        }

        switch (arg) {
            case '-h':
            case '--help':
                config.help = true;
                return config;
            case '--file':
                expect_file = true;
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

    if (expect_file) {
        console.log('Missing file argument to --file');
        config.help = true;
    }

    return config;
}

const PrintHelp = async function() {
    console.log(`iwpotest.js [args]
--help, -h    - Prints this help
--file <file> - Which test file(s) to read and execute. Can be used multiple times and also supports wildcards like *.iwpotest. If a file is specified multiple times, it will only be run once.
--keep, -k    - Keeps generated temporary directories
--verbose, -v - Enables verbose logging
`);
}

const main = async function(): Promise<number> {
    const config: Config = await ParseConfig(process.argv);

    if (config.help) {
        PrintHelp();
        return 0;
    }

    config.ResolveFiles();

    if (config.resolved_files.length == 0) {
        console.log('No test files found');
    }

    return 0;
}

main()
.then(() => {});
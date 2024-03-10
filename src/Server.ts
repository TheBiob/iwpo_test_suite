import * as proc from "child_process"
import path from "path";
import { Test } from "./TestCase";
import { Helper } from "./Helper";

export class Server {
    test: Test;
    script: string;
    process: proc.ChildProcess;

    stdout: string;
    stderr: string;

    public constructor(test: Test) {
        this.test = test;
        this.stdout = '';
        this.stderr = '';
        this.script = path.resolve(test.temp_dir, 'server.mjs');
    }

    private handleServerMessage(message: any) {
        this.test.log_verbose(JSON.stringify(message));
        if (message !== undefined
                && typeof message === 'object'
                && Array.isArray(message.log)
                && typeof message.passed === 'boolean'
                && typeof message.failed === 'boolean'
        ) {
            this.test.log.push(...message.log);
            if (message.failed) {
                this.test.fail(message.log.pop());
            }
            if (message.passed === false) {
                this.test.fail('Server did not receive a PASS message');
            }
        } else {
            this.test.fail(`message structure contained unexpected types`);
        }
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.process = proc.fork(this.script, [], {
                    cwd: this.test.temp_dir,
                    timeout: this.test.timeout*1000,
                    silent: true,
                    env: {
                        'PORT_HTTP': Helper.getPort().toString(), // Doesn't matter, http isn't used. port just needs to be free.
                        'PORT_SOCKETS': this.test.tcp_port.toString(),
                        'PORT_SOCKETS_UDP': this.test.udp_port.toString(),
                        'SERVER_TEST_SUITE': 'enable',
                        // TODO: add verbose logging
                    },
                });
                this.process.stdout.on('data', (msg: string) => { this.stdout += msg.toString(); });
                this.process.stderr.on('data', (msg: string) => { this.stderr += msg.toString(); });
                this.process.on('message', this.handleServerMessage.bind(this));
                this.process.on('spawn', resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    public async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.process.send('get_result_and_close');
                this.process.on('close', resolve);
            } catch (e) {
                reject(e);
            }
        });
    }

    public ok() {
        return this.process !== undefined && this.process.exitCode === 0 && this.stderr === '';
    }

    public kill() {
        if (this.process !== undefined && this.process.exitCode === null) {
            this.process.kill();
        }
    }
}

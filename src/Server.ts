import * as proc from "child_process"
import path from "path";
import { Test } from "./TestCase";
import { Helper } from "./Helper";

export class Server {
    test: Test;
    process: proc.ChildProcess;

    stdout: string;
    stderr: string;

    failed: boolean;
    message: string;

    public constructor(test: Test) {
        this.test = test;
        this.stdout = '';
        this.stderr = '';
        this.failed = false;
        this.message = '';
    }

    private handleServerMessage(message: any) {
        //this.test.log_verbose(JSON.stringify(message));
        if (message !== undefined
                && typeof message === 'object'
                && message.name === 'get_result_and_close'
                && Array.isArray(message.log)
                && typeof message.passed === 'boolean'
                && typeof message.failed === 'boolean'
        ) {
            this.test.log_verbose(message.log);
            if (message.failed) {
                this.fail(message.log.pop());
            }
            if (message.passed === false) {
                this.fail('Server did not receive a PASS message');
            }
        } else {
            this.fail(`message structure contained unexpected types`);
        }
    }
    private fail(msg: string) {
        this.failed = true;
        this.message = msg;
        this.test.log_verbose(msg);
    }

    public start(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                this.process = proc.fork(this.test.config.server_js_resolved, [], {
                    cwd: this.test.temp_dir,
                    timeout: this.test.timeout*1000,
                    silent: true,
                    env: {
                        'PORT_HTTP': Helper.getPort().toString(), // Doesn't matter, http isn't used. port just needs to be free.
                        'PORT_SOCKETS': this.test.tcp_port.toString(),
                        'PORT_SOCKETS_UDP': this.test.udp_port.toString(),
                        'SERVER_TEST_SUITE': 'enable',
                    },
                });
                this.process.stdout.on('data', (msg: string) => { this.stdout += msg.toString(); });
                this.process.stderr.on('data', (msg: string) => { this.stderr += msg.toString(); });
                this.process.on('message', this.handleServerMessage.bind(this));
                this.process.on('spawn', resolve);
                this.process.send({
                    name: 'config',
                    config: this.test.config.simplified(),
                    server_packages: this.test.serialize_packets(),
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    public async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            try {
                if (this.process.exitCode === null && this.process.connected) {
                    this.process.send({ name: 'get_result_and_close' });
                    this.process.on('close', resolve);
                } else {
                    resolve();
                }
            } catch (e) {
                reject(e);
            }
        });
    }

    public ok() {
        return this.process !== undefined && this.process.killed === false && this.process.exitCode === 0 && this.stderr === '' && this.failed === false;
    }

    public kill() {
        if (this.process !== undefined && this.process.exitCode === null) {
            this.process.kill();
        }
    }
}

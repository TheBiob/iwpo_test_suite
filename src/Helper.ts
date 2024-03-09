import * as proc from "child_process"
import fs from "fs/promises";

export class Helper {
    static port: number = 8002;
    
    /**
     * Checks whether or not a file or directory exists at a given path.
     * @param path The path to check for
     * @returns A promise returning true if the path exists, false otherwise
    */
    public static async pathExists(path: string): Promise<boolean> {
        try
        {
            await fs.access(path);
            return true;
        }
        catch
        {
            return false;
        }
    }

    // TODO: is this a good enough method? is there any easy way to get actually free ports?
    /**
     * Returns a network port that has not been used by this program yet.
     * @returns A free port
     */
    public static getPort(): number {
        return this.port++;
    }

    /**
     * Executes a program
     * @param cmd The program to execute
     * @param cwd The working directory in which to execute the program
     * @param verbose Enable verbose logging
     * @param args The arguments appended to the program
     * @returns 
     */
    public static exec(cmd: string, cwd: string, verbose: boolean, timeout: number, ...args: string[]): Promise<{ out: string; err: string; code: number }> {
        return new Promise((resolve, reject) => {
            try
            {
                const std = {
                    out: "",
                    err: "",
                }
                
                if (verbose) {
                    const fullCmd = [cmd, ...args].map(el => `"${el}"`).join(' ');
                    console.log(`Executing command: ${fullCmd}`);
                    console.log(`-> CWD: ${cwd}`);
                }

                const process = proc.spawn(cmd, args, {
                    cwd: cwd,
                    windowsHide: true,
                    shell: false,
                    timeout: timeout*1000,
                    detached: true,
                    env: {},
                });
                for (const stream in std) {
                    process[`std${stream}`].on("data", function(data: string): void {
                        std[stream] += data;
                    });
                }
                process.on("exit", function(code: number): void {
                    resolve({ code: code, out: std.out, err: std.err });
                });
            } catch (e) {
                reject(e);
            }
        });
    }
}

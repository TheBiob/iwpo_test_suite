import path from "path";
import * as fs from "fs/promises";
import { SmartBuffer } from "smart-buffer";

import { Test } from "./TestCase";
import { Helper } from "./Helper";

enum PackageType {
    UNDEFINED, TCP, UDP
}

const PACKAGE_FOLDER = 'server_packages';

export class ServerPackage {
    buffer: SmartBuffer;
    type: PackageType;
    name: string;

    public constructor(name: string, packet: string) {
        this.buffer = new SmartBuffer();
        this.type = PackageType.UNDEFINED;
        this.name = name;
        this.parse(packet);
    }

    public async Initialize(test: Test): Promise<void> {
        const package_folder = path.resolve(test.temp_dir, PACKAGE_FOLDER);
        if (!await Helper.pathExists(package_folder)) {
            test.log_verbose(`Creating server package directory '${package_folder}'`);
            await fs.mkdir(package_folder);
        }

        const fileName = this.name + '.' + PackageType[this.type].toLowerCase();
        test.log_verbose(`Saving server package '${fileName}'`);
        await fs.writeFile(path.resolve(test.temp_dir, PACKAGE_FOLDER, fileName), this.buffer.toBuffer());

        this.buffer.destroy(); // We don't need this buffer anymore, free it
    }

    private parse(packet: string) {
        if (packet.substring(0, 4) !== 'TCP ')
            throw new Error('Only TCP packages are currently implemented');

        this.type = PackageType.TCP;

        let index = 3;
        while (index < packet.length) {
            index++;
            const char = packet[index];
            if (char === ' ') continue;
            else if (char === '"') {
                index = this.parse_string(packet, index);
            } else {
                // Not a space or a string, grab the next part and try and add as a number
                let next_index = packet.indexOf(' ', index);
                if (next_index < index)
                    next_index = packet.length;

                const value = packet.substring(index, next_index);
                index = next_index;

                this.parse_number(value);
            }
        }
    }
    private parse_string(input: string, start_index: number): number {
        let outStr = '';

        let i = start_index+1;
        for (; i < input.length && input[i] != '"'; i++) {
            if (input[i] == '\\' && i < input.length-1)
                i++; // If we encounter a \ that is not at the end of the string, add the next character regardless of what it is.
            outStr += input[i];
        }

        if (i == input.length)
            throw new Error(`Unclosed string at ${start_index} in server package '${this.name}'`);

        this.buffer.writeStringNT(outStr);

        return i;
    }
    private parse_number(input: string) {
        let number = Number('0x'+input);
        if (!Number.isNaN(number)) {
            switch (input.length) {
                case 2:
                    this.buffer.writeUInt8(number);
                    return;
                case 4:
                    this.buffer.writeUInt16LE(number);
                    return;
                case 8:
                    this.buffer.writeUInt32LE(number);
                    return;
                default:
                    throw new Error(`Uknown byte length '${input.length}' in server package '${this.name}'`);
            }
        }

        // Not a hex number, assume decimal double
        number = Number(input);
        if (Number.isNaN(number))
            throw new Error(`Could not parse '${input}' as a number in server package '${this.name}'`);

        this.buffer.writeDoubleLE(number);
    }
}

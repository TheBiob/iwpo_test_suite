import { SmartBuffer } from "smart-buffer";

export class ServerPackage {
    buffer: SmartBuffer;

    public constructor(packet: string) {
        this.buffer = new SmartBuffer();
        this.parse(packet);
    }

    private parse(packet: string) {
        throw new Error('Method ServerPackage.parse not implemented.');
    }
}

import path from "path";

import * as Helper from "./Helper";
import { Test } from "./TestCase";

enum EventOccurrence {
    pre, post, test
}
const knownTestFiles = ['Step', 'GameBegin'];

export class IwpoEvent {
    test: Test;
    gml: string;
    file: string;
    file_path: string;
    condition: EventOccurrence;

    public constructor(condition: string, file: string, gml: string, test: Test) {
        if (condition === 'pre') {
            this.condition = EventOccurrence.pre;
        } else if (condition === 'post') {
            this.condition = EventOccurrence.post;
        } else if (condition === 'test') {
            this.condition = EventOccurrence.test;
        } else {
            throw new Error(`Unimplemented event occurrence '${condition}'`);
        }

        this.gml = gml;
        this.file = file;
        this.test = test;
    }

    getFile(): string {
        const path_sections: string[] = [];
        if (this.test.is_gms) {
            path_sections.push('lib');
            path_sections.push('GMS');
        } else {
            path_sections.push('gml');
        }

        if (this.condition === EventOccurrence.test) {
            path_sections.push('test');
        }

        return path.join(...path_sections, this.file + '.gml');
    }

    public async checkFile(): Promise<void> {
        if (this.condition === EventOccurrence.test) {
            if (knownTestFiles.indexOf(this.file) < 0) {
                throw new Error(`Test File '${this.file}' is unknown`);
            }
        } else {
            let file = path.join(this.test.config.iwpo_data, this.getFile());
            if (!await Helper.pathExists(file)) {
                throw new Error(`File '${file}' does not exist`);
            }
        }
    }
}

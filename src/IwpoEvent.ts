import path from "path";
import * as fs from "fs/promises";

import * as Helper from "./Helper";
import { Test } from "./TestCase";

enum EventOccurrence {
    pre, post, test
}
const knownTestFiles = ['Step', 'GameBegin'];

export class IwpoEvent {
    test: Test;
    gml: Map<EventOccurrence, string>;
    file: string;
    file_path: string;

    public constructor(file: string, test: Test) {
        this.file = file;
        this.test = test;
        this.gml = new Map<EventOccurrence, string>;
    }

    public async setGml(condition: string, gml: string): Promise<void> {
        let occurrence = -1;
        if (condition === 'pre') {
            occurrence = EventOccurrence.pre;
        } else if (condition === 'post') {
            occurrence = EventOccurrence.post;
        } else if (condition === 'test') {
            occurrence = EventOccurrence.test;
        } else {
            throw new Error(`Unimplemented event occurrence '${condition}'`);
        }

        if (occurrence === EventOccurrence.test) {
            if (knownTestFiles.indexOf(this.file) < 0) {
                throw new Error(`Test File '${this.file}' is unknown`);
            }
        } else {
            let file = path.join(this.test.config.iwpo_data, this.getFile(occurrence));
            if (!await Helper.pathExists(file)) {
                throw new Error(`File '${file}' does not exist`);
            }
        }
        
        if (this.gml.has(occurrence)) {
            throw new Error(`GML for '${EventOccurrence[occurrence]}_${this.file}' already defined`);
        }
        this.gml.set(occurrence, gml);
    }

    public async Initialize(): Promise<void> {
        const preGml = this.gml.get(EventOccurrence.pre);
        const postGml = this.gml.get(EventOccurrence.post);
        const testGml = this.gml.get(EventOccurrence.test);

        if (preGml !== undefined || postGml !== undefined) {
            const filePath = path.resolve(this.test.temp_dir, 'data', this.getFile(EventOccurrence.pre));
            
            let content = await fs.readFile(filePath, { encoding: 'utf-8' });
            if (preGml !== undefined) {
                content = preGml + '\r\n//// END PRE GML ////\r\n' + content;
            }
            if (postGml !== undefined) {
                content += '\r\n//// BEGIN POST GML ////\r\n' + postGml;
            }
            
            await fs.writeFile(filePath, content);
        }

        if (testGml !== undefined) {
            const filePath = path.resolve(this.test.temp_dir, 'data', this.getFile(EventOccurrence.test));
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, testGml);
        }
    }

    private getFile(condition: EventOccurrence): string {
        const path_sections: string[] = [];
        if (this.test.is_gms) {
            path_sections.push('lib');
            path_sections.push('GMS');
        } else {
            path_sections.push('gml');
        }

        if (condition === EventOccurrence.test) {
            path_sections.push('test');
        }

        return path.join(...path_sections, this.file + '.gml');
    }
}

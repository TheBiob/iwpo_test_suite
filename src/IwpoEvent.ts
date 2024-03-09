import path from "path";
import * as fs from "fs/promises";

import { Helper } from "./Helper";
import { Test } from "./TestCase";

enum EventOccurrence {
    pre, post, test
}
const defaultTestFileCode = {
    'Step': ``,

    'GameBegin': `
@fname = "@var_ds_list.txt";
@vars_loaded = file_exists(@fname);
if (@vars_loaded) {
    @f = file_text_open_read(@fname);
    @vars = file_text_read_real(@f);
} else {
    @vars = ds_list_create();
    @f = file_text_open_write(@fname);
    file_text_write_real(@f,@vars);
}
file_text_close(@f);
    `,
};

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

    public static defaultEvents(test: Test): IwpoEvent[] {
        const events: IwpoEvent[] = [];
        for (const file in defaultTestFileCode) {
            events.push(new IwpoEvent(file, test));
        }
        return events;
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
            if (defaultTestFileCode[this.file] === undefined) {
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
        
        if (preGml !== undefined || postGml !== undefined) {
            const filePath = path.resolve(this.test.temp_dir, 'data', this.getFile(EventOccurrence.pre));
            
            let content = await fs.readFile(filePath, { encoding: 'utf-8' });
            if (preGml !== undefined) {
                content = preGml + '\r\n/* END PRE GML */\r\n' + content; // Closes any potential stray block comments
            }
            if (postGml !== undefined) {
                content += '\r\n/* BEGIN POST GML */\r\n' + postGml; // Closes any potential stray block comments
            }
            
            await fs.writeFile(filePath, content);
        }
        
        const defaultCode = defaultTestFileCode[this.file];
        if (defaultCode !== undefined) {
            let testGml = this.gml.get(EventOccurrence.test);
            if (testGml === undefined) {
                testGml = defaultCode;
            } else {
                testGml = defaultCode + '\r\n' + testGml;
            }
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

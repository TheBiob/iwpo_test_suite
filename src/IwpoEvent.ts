import path from "path";
import * as fs from "fs/promises";

import { Helper } from "./Helper";
import { Test } from "./TestCase";

export enum EventOccurrence {
    pre, post, script
}
const defaultTestFileCode = {
    'TestStep': ``,

    'TestGameBegin': `
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
            const ev = new IwpoEvent(file, test);
            ev.setGml('pre', defaultTestFileCode[file]);
            events.push(ev);
        }
        return events;
    }

    public async setGml(condition: string, gml: string): Promise<void> {
        let occurrence = -1;
        if (condition === 'pre') {
            occurrence = EventOccurrence.pre;
        } else if (condition === 'post') {
            occurrence = EventOccurrence.post;
        } else if (condition === 'script') {
            occurrence = EventOccurrence.script;
        } else {
            throw new Error(`Unimplemented event occurrence '${condition}'`);
        }

        if (occurrence === EventOccurrence.script) {
            // Ok, we will just pass it to iwpo as is
        } else if (defaultTestFileCode[this.file] !== undefined) {
            // Ok, these files have special handling and don't need to exist on disk
        } else {
            let file = path.join(this.test.config.iwpo_data, this.getFile());
            if (!await Helper.pathExists(file)) {
                throw new Error(`File '${file}' does not exist`);
            }
        }
        
        if (this.gml.has(occurrence)) {
            throw new Error(`GML for '${EventOccurrence[occurrence]}_${this.file}' already defined`);
        }
        this.gml.set(occurrence, gml);
    }

    private getFile(): string {
        const path_sections: string[] = [];
        if (this.test.is_gms) {
            path_sections.push('lib');
            path_sections.push('GMS');
        } else {
            path_sections.push('gml');
        }

        return path.join(...path_sections, this.file + '.gml');
    }
}

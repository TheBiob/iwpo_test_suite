import path from "path";
import { Config } from ".";
import { Test } from "./TestCase";
import { glob } from "glob";

export async function RunIwpoTests(config: Config): Promise<boolean> {
    const tests = await Promise.all(
        config.resolved_files.map(async filename => {
            const t: Test = new Test(config, path.basename(filename));
            await t.readFromFile(filename);
            return t;
        })
    );

    return await _runTests(tests, config);
}

export async function TestDirectory(config: Config): Promise<void> {
    const tests = await Promise.all(
        (await glob(config.test_dir_resolved + '/**/*.exe', { absolute: true })).map(async filename => {
            if (filename.includes('_online')) {
                console.log('skipping file ' + filename);
                return null;
            } else {
                const t: Test = new Test(config, path.basename(filename));
                await t.readFromDefaultExe(filename);
                return t;
            }
        })
    );

    await _runTests(tests.filter(x => x !== null), config);
}

async function _runTests(tests: Test[], config: Config): Promise<boolean> {
    let max_runners = config.max_parallel == 0 ? tests.length : Math.min(config.max_parallel, tests.length);

    console.log(`Executing tests with ${max_runners} in parallel...`);
    await Promise.all(new Array<IterableIterator<Test>>(max_runners).fill(tests.values()).map(async iter => {
        for (const test of iter) {
            console.log(`[${test.name}] Initializing...`);
            if (test.can_execute())
                await test.Initialize();
            console.log(`[${test.name}] Running...`);
            if (test.can_execute())
                await test.Run();
            console.log(`[${test.name}] Cleaning...`);
            await test.Clean();
        }
    }));

    let passed = 0;
    for (const test of tests) {
        console.log(test.testResult());
        if (test.passed()) {
            passed++;
        }
    }

    console.log('');
    console.log(`Result: ${passed}/${tests.length} passed.`);

    return passed === tests.length;
}

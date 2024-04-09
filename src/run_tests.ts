import path from "path";
import { Config } from ".";
import { Test } from "./TestCase";

export async function RunIwpoTests(config: Config): Promise<boolean> {
    const tests = await Promise.all(
        config.resolved_files.map(async filename => {
            const t: Test = new Test(config, path.basename(filename));
            await t.readFromFile(filename);
            return t;
        })
    );

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

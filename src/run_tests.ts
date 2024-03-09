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

    for (const test of tests) {
        if (test.can_execute()) await test.Initialize();
        if (test.can_execute()) await test.Run();
        if (!config.keep) await test.Clean();
    }

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

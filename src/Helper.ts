import fs from "fs/promises";

/**
 * Checks whether or not a file or directory exists at a given path.
 * @param path The path to check for
 * @returns A promise returning true if the path exists, false otherwise
 */
export async function pathExists(path: string): Promise<boolean> {
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

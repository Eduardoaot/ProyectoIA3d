import { readFile } from 'node:fs/promises'

export async function fixture(name) {
    return JSON.parse(await readFile(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'))
}

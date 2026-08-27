import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(frontendRoot, "public");
const manifestPath = path.join(publicRoot, "avatars", "manifest.json");

async function collectVRMFiles(directory) {
    let entries = [];

    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch {
        return [];
    }

    const files = [];
    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;

        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectVRMFiles(entryPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".vrm")) {
            files.push(entryPath);
        }
    }

    return files;
}

function titleFromFile(filePath) {
    return path.basename(filePath, path.extname(filePath))
        .replace(/[-_]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const files = (await collectVRMFiles(publicRoot))
    .sort((first, second) => first.localeCompare(second));

const avatars = files.map((filePath) => {
    const relativePath = path.relative(publicRoot, filePath).split(path.sep).join("/");
    const id = relativePath.replace(/\.vrm$/i, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();

    return {
        id,
        name: titleFromFile(filePath),
        path: `/${relativePath}`,
        description: "VRM avatar from your SignStream library"
    };
});

await writeFile(
    manifestPath,
    `${JSON.stringify({ version: 1, avatars }, null, 2)}\n`,
    "utf8"
);

console.log(`Avatar catalog generated: ${avatars.length} VRM file(s)`);

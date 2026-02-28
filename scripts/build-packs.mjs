/**
 * Build script: compiles JSON data files into Foundry VTT LevelDB compendium packs.
 *
 * Usage: node scripts/build-packs.mjs
 *
 * Reads data/*.json and writes LevelDB packs into packs/<name>/
 */

import { ClassicLevel } from "classic-level";
import { readFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

/** Generate a Foundry-compatible 16-char random ID */
function foundryId() {
    return randomUUID().replace(/-/g, "").slice(0, 16);
}

/** Pack definitions: maps pack name to data source and item collection key */
const PACKS = [
    { name: "homeworlds", file: "data/homeworlds.json", collection: "items" },
    { name: "backgrounds", file: "data/backgrounds.json", collection: "items" },
    { name: "roles", file: "data/roles.json", collection: "items" },
    { name: "talents", file: "data/talents.json", collection: "items" },
    { name: "weapons", file: "data/weapons.json", collection: "items" },
    { name: "gear", file: "data/gear.json", collection: "items" },
    { name: "traits", file: "data/traits.json", collection: "items" },
    { name: "npcs", file: "data/npcs.json", collection: "actors" },
];

async function buildPack(packDef) {
    const dataPath = resolve(ROOT, packDef.file);
    if (!existsSync(dataPath)) {
        console.warn(`  ⚠ Skipping ${packDef.name}: ${packDef.file} not found`);
        return 0;
    }

    const packDir = resolve(ROOT, "packs", packDef.name);

    // Clear existing pack
    if (existsSync(packDir)) {
        rmSync(packDir, { recursive: true });
    }
    mkdirSync(packDir, { recursive: true });

    // Read source data
    const items = JSON.parse(readFileSync(dataPath, "utf-8"));
    if (items.length === 0) {
        console.warn("empty");
        return 0;
    }

    // Open LevelDB
    const db = new ClassicLevel(packDir, { valueEncoding: "json" });
    await db.open();

    let count = 0;
    const batch = db.batch();

    // Foundry V13 uses LevelDB sublevels for embedded documents.
    // Actor items stored at !actors.items!<actorId>.<itemId>
    const embeddedKey = packDef.collection === "actors" ? "items" : null;

    for (const item of items) {
        const id = item._id || foundryId();

        // Process embedded documents (actor items)
        const embeddedIds = [];
        if (embeddedKey && Array.isArray(item[embeddedKey])) {
            for (let i = 0; i < item[embeddedKey].length; i++) {
                const embedded = item[embeddedKey][i];
                const embeddedId = embedded._id || foundryId();

                const embeddedDoc = {
                    _id: embeddedId,
                    name: embedded.name,
                    type: embedded.type,
                    img: embedded.img || "icons/svg/item-bag.svg",
                    system: embedded.system || {},
                    effects: embedded.effects || [],
                    flags: embedded.flags || {},
                    sort: i * 100000,
                    ownership: { default: 0 },
                    _stats: {
                        compendiumSource: null,
                        duplicateSource: null,
                        coreVersion: "13.351",
                        systemId: "dh2e",
                        systemVersion: "0.1.0",
                        createdTime: Date.now(),
                        modifiedTime: Date.now(),
                        lastModifiedBy: "dh2eBu1ldScr1pt",
                    },
                };

                const sublevelKey = `!${packDef.collection}.${embeddedKey}!${id}.${embeddedId}`;
                batch.put(sublevelKey, embeddedDoc);
                embeddedIds.push(embeddedId);
            }
        }

        // Build top-level document
        const doc = {
            _id: id,
            name: item.name,
            type: item.type,
            img: item.img || "icons/svg/item-bag.svg",
            system: item.system || {},
            ...(embeddedKey ? { [embeddedKey]: embeddedIds } : {}),
            effects: item.effects || [],
            flags: item.flags || {},
            sort: count * 100000,
            ownership: { default: 0 },
            _stats: {
                compendiumSource: null,
                duplicateSource: null,
                coreVersion: "13.351",
                systemId: "dh2e",
                systemVersion: "0.1.0",
                createdTime: Date.now(),
                modifiedTime: Date.now(),
                lastModifiedBy: "dh2eBu1ldScr1pt",
            },
        };

        const key = `!${packDef.collection}!${id}`;
        batch.put(key, doc);

        count++;
    }

    await batch.write();
    await db.close();

    return count;
}

async function main() {
    console.log("Building DH2E Enemies Without packs...\n");

    let totalItems = 0;
    for (const pack of PACKS) {
        process.stdout.write(`  📦 ${pack.name}... `);
        const count = await buildPack(pack);
        console.log(`${count} items`);
        totalItems += count;
    }

    console.log(
        `\n✅ Done! ${totalItems} total items across ${PACKS.length} packs.`,
    );
}

main().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
});

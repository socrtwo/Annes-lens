// Writes the built-in working-space profiles to tests/fixtures/color/ (input to gen-color-fixtures.py).
import { writeFileSync } from 'node:fs';
import { SPACES, spaceIcc } from '../src/color/spaces';
for (const s of SPACES) writeFileSync(`tests/fixtures/color/${s.id}.icc`, spaceIcc(s.id));
console.log(`wrote ${SPACES.length} profiles`);

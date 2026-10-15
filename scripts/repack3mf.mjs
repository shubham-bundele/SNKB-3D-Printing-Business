import fs from 'node:fs';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'three/examples/jsm/libs/fflate.module.js';
import * as THREE from 'three';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

const buf = fs.readFileSync('public/samples/cube_30mm.3mf');
const unzipped = unzipSync(new Uint8Array(buf));
const modelContent = strFromU8(unzipped['3D/3dmodel.model']);

const relsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml" />
</Types>`;

const zipped = zipSync({
  '_rels/.rels': strToU8(relsXml),
  '[Content_Types].xml': strToU8(contentTypesXml),
  '3D/3dmodel.model': strToU8(modelContent),
});

fs.writeFileSync('public/samples/cube_30mm.3mf', Buffer.from(zipped));
console.log('Wrote public/samples/cube_30mm.3mf, size:', zipped.length);

const loader = new ThreeMFLoader();
const group = loader.parse(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength));
console.log('Successfully parsed with ThreeMFLoader! Children count:', group.children.length);

const fs = require('fs');
const pathsData = JSON.parse(fs.readFileSync('paths.json', 'utf8'));
function snap(coord) {
    return Number(coord[0]).toFixed(5) + ',' + Number(coord[1]).toFixed(5);
}
const g = new Map();
function addEdge(uStr, vStr) {
    if (!g.has(uStr)) g.set(uStr, []);
    if (!g.has(vStr)) g.set(vStr, []);
    g.get(uStr).push(vStr);
    g.get(vStr).push(uStr);
}
pathsData.features.forEach(feature => {
    const coords = feature.geometry.coordinates;
    for (let i = 0; i < coords.length - 1; i++) {
        const uStr = snap(coords[i]);
        const vStr = snap(coords[i+1]);
        if (uStr !== vStr) {
            addEdge(uStr, vStr);
        }
    }
});
console.log('Total nodes:', g.size);
const visited = new Set();
let components = 0;
for (const node of g.keys()) {
    if (!visited.has(node)) {
        components++;
        const q = [node];
        visited.add(node);
        while(q.length > 0) {
            const u = q.shift();
            for (const v of g.get(u)) {
                if (!visited.has(v)) {
                    visited.add(v);
                    q.push(v);
                }
            }
        }
    }
}
console.log('Total connected components (islands):', components);

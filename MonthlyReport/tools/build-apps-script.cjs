const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const core=fs.readFileSync(path.join(root,'js/report-core.js'),'utf8');
const workflow=fs.readFileSync(path.join(root,'tools/apps-script/workflow.gs'),'utf8');
const validation=fs.readFileSync(path.join(root,'tools/apps-script/validation.gs'),'utf8');
fs.writeFileSync(path.join(root,'apps-script/Code.gs'),core+'\n'+workflow+'\n'+validation);
console.log('Built apps-script/Code.gs');

/* Preserve the same-origin URL contract in a dependency-free static build. */
const fs=require('node:fs');const path=require('node:path');
const root=__dirname,out=path.join(root,'dist');fs.rmSync(out,{recursive:true,force:true});fs.mkdirSync(path.join(out,'static'),{recursive:true});
for(const name of fs.readdirSync(root)){if(name.endsWith('.html'))fs.copyFileSync(path.join(root,name),path.join(out,name));if(/\.(css|js)$/.test(name)&&name!=='vite.config.js')fs.copyFileSync(path.join(root,name),path.join(out,'static',name));}
console.log('Built same-origin pages and /static assets in frontend/dist. The API must be served on the same origin.');

const packaged=path.join(root,'../backend/traceguard/static');fs.mkdirSync(packaged,{recursive:true});for(const name of fs.readdirSync(root)){if(/\.(html|css|js)$/.test(name)&&name!=='vite.config.js')fs.copyFileSync(path.join(root,name),path.join(packaged,name));}

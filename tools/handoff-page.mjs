// Run only inside the scoped candidate sandbox; harmless loopback human check.
import http from 'node:http';
import {randomUUID} from 'node:crypto';
const token = `chromium-foundation-${randomUUID()}`;
const server = http.createServer((req,res)=>{
 res.setHeader('content-type','text/html; charset=utf-8');
 res.end(`<!doctype html><title>${token}</title><h1>${token}</h1><p>Copy out: <span>${token}-copy</span></p><p>Path: ${req.url === '/pasted' ? 'pasted' : 'home'}</p><button onclick="this.textContent='Responsive'">Check response</button><script>
(navigator.modelContext || document.modelContext)?.registerTool({name:'identify',description:'Return harmless handoff token',inputSchema:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'${token}'}]})});
</script>`);
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({token,url:`http://127.0.0.1:${server.address().port}/`,pasteUrl:`http://127.0.0.1:${server.address().port}/pasted`})));

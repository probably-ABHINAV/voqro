import test from 'node:test';
import assert from 'node:assert/strict';
import {createAzureAIProvider,validateAzureAIConfig} from '../azure-ai.mjs';
const config={azureEndpoint:'https://test.openai.azure.com/',azureDeployment:'review'};
const input={brief:{requirements:'Show product'},knowledge:null,package:{caption:'Untrusted package text'},coverage:'Three sampled images; audio not analysed',frames:[{seconds:0,bytes:Buffer.from('test-image')}]};
const answer=()=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({findings:[]})}}],usage:{prompt_tokens:50,completion_tokens:10}},{headers:{'apim-request-id':'test-request'}});
test('Azure endpoint validation rejects alternate hosts, credentials, paths and insecure endpoints',()=>{
 for(const azureEndpoint of ['http://test.openai.azure.com/','https://evil.example/','https://test.openai.azure.com.evil.example/','https://test.openai.azure.com/path','https://user:secret@test.openai.azure.com/'])assert.throws(()=>validateAzureAIConfig({...config,azureEndpoint}));
 assert.throws(()=>validateAzureAIConfig({...config,azureDeployment:'../other'}));
});
test('Azure inference uses managed identity only and carries bounded evidence with explicit audio limitation',async()=>{
 const calls=[];const provider=createAzureAIProvider(config,{request:async(url,options)=>{calls.push({url,options});return url.startsWith('http://169.')?Response.json({access_token:'private-test-token',expires_on:Math.floor(Date.now()/1000)+3600}):answer();}});
 const result=await provider.analyse(input);await provider.analyse(input);
 assert.equal(calls.filter(c=>c.url.startsWith('http://169.')).length,1);assert.equal(calls[0].options.headers.Metadata,'true');
 assert.equal(calls[1].options.headers.Authorization,'Bearer private-test-token');assert.equal(calls[1].options.redirect,'error');
 const payload=JSON.parse(calls[1].options.body);assert.equal(payload.max_tokens,1200);assert.match(payload.messages[0].content,/Audio is NOT analysed/);assert.equal(payload.messages[1].content[2].image_url.detail,'low');assert.equal(result.request_id,'test-request');assert.equal(JSON.stringify(result).includes('private-test-token'),false);
});
test('Azure rejects oversized input before acquiring credentials and does not retry failed inference',async()=>{
 let tokens=0,calls=0;const provider=createAzureAIProvider(config,{credential:async()=>{tokens++;return 'private-token';},request:async()=>{calls++;return new Response('secret provider diagnostics',{status:429});}});
 await assert.rejects(provider.analyse({...input,brief:{text:'x'.repeat(40001)}}));assert.equal(tokens,0);
 await assert.rejects(provider.analyse(input),error=>!error.message.includes('secret'));assert.equal(calls,1);
});
test('Azure rejects truncated and malformed responses rather than creating a false report',async()=>{
 for(const response of [Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),Response.json({choices:[{finish_reason:'stop',message:{content:'invalid-json'}}]})]){
  const provider=createAzureAIProvider(config,{credential:async()=>'private-token',request:async()=>response});await assert.rejects(provider.analyse(input));
 }
});

function t(e){return e.mimeType.startsWith("audio/")&&e.metadata?.kind!=="voice_clone_preview"}function s(e){return e.flatMap(i=>(i.coverAssets||[]).filter(t).slice(0,1))}export{t as i,s as v};

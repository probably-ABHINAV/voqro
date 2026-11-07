'use client';
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <main id="main-content" className="max-w-xl mx-auto p-8 my-20"><h1>Let’s get you back to work.</h1><p className="muted mt-4 mb-6">This page could not be loaded. Your saved records have not been changed.</p><button className="btn btn-primary" onClick={reset}>Try again</button></main>;}

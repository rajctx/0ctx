const auth0 = require('@auth0/nextjs-auth0/server');
console.log('Exports from @auth0/nextjs-auth0/server:');
console.log(Object.keys(auth0));

try {
    const edge = require('@auth0/nextjs-auth0/edge');
    console.log('\nExports from @auth0/nextjs-auth0/edge:');
    console.log(Object.keys(edge));
} catch (e) { }

try {
    const client = require('@auth0/nextjs-auth0/client');
    console.log('\nExports from @auth0/nextjs-auth0/client:');
    console.log(Object.keys(client));
} catch (e) { }

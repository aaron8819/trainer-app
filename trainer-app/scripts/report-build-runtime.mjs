// Non-secret build evidence, emitted by the same npm lifecycle on CI and Vercel.
console.log(`Trainer build runtime: ${JSON.stringify({
  node: process.version,
  npm: process.env.npm_config_user_agent?.match(/(?:^| )npm\/([\d.]+)/)?.[1] ?? 'unknown',
})}`);

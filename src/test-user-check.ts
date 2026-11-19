import { linkedInDeduplicationService } from './services/linkedin-dedup.service.js';

const postContent = `Everyone seems to have forgotten that code is a liability, not an asset.

That means that producing thousands of lines of code you didn’t read isn’t something to celebrate. It’s something to worry about!

Every line of code needs to be tested, secured, and maintained.  Even the ones that create no value for customers and therefore no value to the business.

That’s why every line of code is a liability. And producing more liabilities isn’t good engineering or good business.

Good engineering isn't about producing more code. It's about solving problems with the least amount of code.

The asset is the solution, not the code`;

async function main() {
  const result = await linkedInDeduplicationService.checkDuplicate(postContent);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);

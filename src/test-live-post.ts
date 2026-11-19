import { postService } from './services/post.service.js';

async function main() {
  console.log('Sending live test post to LinkedIn...');
  
  const post = await postService.createPost({
    content: '🚀 Testing our automated Content Engine integration! Excited to share more updates soon.\n\n#BuildingInPublic #Engineering #Automation',
    publishNow: true,
  });

  console.log('\nPost result:');
  console.log('Status:', post.status);
  console.log('Post URN:', post.linkedinPostUrn);
  console.log('Live URL:', post.linkedinPostUrn ? `https://www.linkedin.com/feed/update/${post.linkedinPostUrn}` : 'N/A');
  if (post.error) {
    console.error('Error detail:', post.error);
  }
}

main().catch(console.error);

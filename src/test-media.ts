import { linkedInService } from './services/linkedin.service.js';

async function main() {
  console.log('Testing live image upload to LinkedIn...');
  try {
    const res = await linkedInService.publishPost(
      '📸 Testing image upload via Content Engine API!\n\n#BuildingInPublic #AI #Automation',
      [
        {
          type: 'IMAGE',
          url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=80',
          altText: 'Abstract AI visualization'
        }
      ]
    );
    console.log('Post result:', res);
  } catch (err: any) {
    console.error('Error:', err);
  }
}

main().catch(console.error);

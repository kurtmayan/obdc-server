import { ConfigService } from "@nestjs/config";

export default async function authenticateMyHr(configService : ConfigService) {
    const apiUrl = configService.getOrThrow<string>('MYHR_API_URL');
    const username = configService.getOrThrow<string>('MYHR_USERNAME');
    const password = configService.getOrThrow<string>('MYHR_PASSWORD');

    const response = await fetch(`${apiUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(`MyHR login failed: ${response.status} ${response.statusText} - ${responseBody}`);
    }

    let data: { accessToken?: string };

    try {
      data = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      throw new Error(`MyHR login returned invalid JSON: ${responseBody}`);
    }

    if (!data.accessToken) {
      throw new Error('MyHR login succeeded but no token was returned.');
    }

    return data.accessToken;
}
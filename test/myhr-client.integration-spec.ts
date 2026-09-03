import { ConfigService } from '@nestjs/config';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { MyHrClient } from 'src/modules/myhr/myhr.client';

describe('MyHR client with a deterministic fake vendor', () => {
  let server: Server;
  let client: MyHrClient;
  let status = 'queued';

  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url === '/api/login') {
        response.end('{"accessToken":"test-token"}');
        return;
      }
      if (request.url === '/api/biometric/upload/bulk') {
        response.end('{"batchId":"batch-1"}');
        return;
      }
      if (request.url === '/api/biometric/upload/bulk/status/batch-1') {
        response.end(JSON.stringify({ result: { status } }));
        return;
      }
      response.statusCode = 404;
      response.end('{"error":"not found"}');
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const port = (server.address() as AddressInfo).port;
    client = new MyHrClient(
      new ConfigService({
        MYHR_API_URL: `http://127.0.0.1:${port}`,
        MYHR_USERNAME: 'user',
        MYHR_PASSWORD: 'password',
        MYHR_HTTP_TIMEOUT_MS: '5000',
        MYHR_STATUS_FIELD: 'result.status',
        MYHR_STATUS_PENDING_VALUES: 'queued',
        MYHR_STATUS_SUCCESS_VALUES: 'completed',
        MYHR_STATUS_FAILED_VALUES: 'failed',
      }),
    );
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('uploads once and maps pending then successful verification', async () => {
    await expect(
      client.upload([
        {
          empid: 'employee-1',
          logdt: '09/02/2026',
          logtm: '09/02/2026 08:00',
          logstats: 1,
          location: 'Store 1',
        },
      ]),
    ).resolves.toEqual({ batchId: 'batch-1' });
    await expect(client.getBatchStatus('batch-1')).resolves.toMatchObject({
      status: 'PENDING',
    });
    status = 'completed';
    await expect(client.getBatchStatus('batch-1')).resolves.toMatchObject({
      status: 'SUCCESS',
    });
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';

test('uploaded file payload uses configured public base url when present', async () => {
  const { requestPublicBaseUrl, uploadedFilePayloadFromMulterFile } = await import('../src/modules/content/content.routes.js');

  const publicBaseUrl = requestPublicBaseUrl({
    headers: {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'assets.example.com',
    },
  });

  assert.equal(publicBaseUrl, 'http://124.221.146.111:5689');

  const payload = uploadedFilePayloadFromMulterFile({
    originalname: '头像.jpeg',
    filename: '1718528455000-asset.jpeg',
    mimetype: 'image/jpeg',
    size: 123,
    path: '/tmp/1718528455000-asset.jpeg',
  } as Express.Multer.File, publicBaseUrl);

  assert.equal(payload.fileUrl, '/files/1718528455000-asset.jpeg');
  assert.equal(payload.publicFileUrl, 'http://124.221.146.111:5689/files/1718528455000-asset.jpeg');
  assert.equal(payload.originalFileName, '头像.jpeg');
});

test('request public base url keeps configured value regardless of request host', async () => {
  const { requestPublicBaseUrl } = await import('../src/modules/content/content.routes.js');

  assert.equal(requestPublicBaseUrl({ headers: { host: 'localhost:7072' } }), 'http://124.221.146.111:5689');
  assert.equal(requestPublicBaseUrl({ headers: { host: '127.0.0.1:7072' } }), 'http://124.221.146.111:5689');
  assert.equal(requestPublicBaseUrl({ headers: { host: '192.168.1.9:7072' } }), 'http://124.221.146.111:5689');
  assert.equal(requestPublicBaseUrl({ headers: { host: 'demo.example.com' } }), 'http://124.221.146.111:5689');
  assert.equal(requestPublicBaseUrl({ headers: {} }), 'http://124.221.146.111:5689');
});

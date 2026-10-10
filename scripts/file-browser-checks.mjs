import assert from 'node:assert/strict';

// These checks run against the installed extension in every supported browser.
// Only the transport adapter differs: Playwright routes versus Firefox BiDi.
export async function runFileBrowserChecks({ evaluate, goto, click, wait, fixtures, check, base, screenshot }) {
  const source = 'https://elearning.fudan.edu.cn/courses/123/files/880/download';
  const ready = () => wait(() => document.querySelector('#status')?.hidden);
  const failed = () => wait(() => document.querySelector('#status-title')?.textContent === '暂时无法预览');
  const open = async (format, body, contentType, name = `fixture.${format === 'text' ? 'txt' : format}`) => {
    fixtures.set(source, { body, contentType });
    await goto(`${base}file-viewer.html?${new URLSearchParams({ source, original: source, format, name })}`);
  };
  const select = value => evaluate(value => { const el = document.querySelector('#encoding'); el.value = value; el.dispatchEvent(new Event('change')); }, value);
  const trackUrls = () => evaluate(() => {
    window.testRevoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = value => { window.testRevoked.push(value); revoke(value); };
  });
  const images = await evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1200;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#2456a6'; ctx.fillRect(0,0,2400,1200);
    ctx.fillStyle = '#fff'; ctx.fillRect(200,200,500,500);
    return ['png','jpeg','webp'].map(format => [format, canvas.toDataURL(`image/${format}`).split(',')[1]]);
  });
  for (const [format, b64] of images) await check(`installed ${format}: decode, zoom, rotated bounding geometry and viewport fit`, async () => {
    await open(format, Buffer.from(b64,'base64'), `image/${format}`); await ready();
    assert.equal(await evaluate(() => document.querySelector('#image').naturalWidth),2400);
    const geometry = () => evaluate(() => {
      const img = document.querySelector('#image').getBoundingClientRect(), frame = document.querySelector('#image-frame').getBoundingClientRect(), workspace = document.querySelector('#workspace');
      return { width:img.width,height:img.height,frameWidth:frame.width,frameHeight:frame.height,availableWidth:workspace.clientWidth,availableHeight:workspace.clientHeight,rotation:document.querySelector('#image').dataset.rotation };
    });
    const before = await geometry(); await click('#zoom-in'); const zoom = await geometry(); assert.ok(zoom.width > before.width);
    await click('#zoom-out'); assert.ok(Math.abs((await geometry()).width - before.width) < 2);
    await click('#rotate'); await click('#fit'); const rotated = await geometry();
    assert.equal(rotated.rotation,'90'); assert.ok(Math.abs(rotated.height / rotated.width - 2) < .02);
    assert.ok(Math.abs(rotated.width-rotated.frameWidth)<2 && Math.abs(rotated.height-rotated.frameHeight)<2);
    assert.ok(rotated.width <= rotated.availableWidth && rotated.height <= rotated.availableHeight);
    await screenshot(`acceptance-${format}.png`);
  });
  await check('installed JPEG: EXIF orientation uses decoded swapped dimensions', async () => {
    const jpeg = Buffer.from(images.find(([format]) => format === 'jpeg')[1],'base64');
    const exif = Buffer.from('ffe1002245786966000049492a0008000000010012010300010000000600000000000000','hex');
    await open('jpeg',Buffer.concat([jpeg.subarray(0,2),exif,jpeg.subarray(2)]),'image/jpeg'); await ready();
    assert.deepEqual(await evaluate(() => [document.querySelector('#image').naturalWidth,document.querySelector('#image').naturalHeight]),[1200,2400]);
  });
  await check('installed text: literal markup, wrap, clipboard result and denial fallback', async () => {
    const text = '中文 <script>window.injectedFileScript = true</script>\n' + 'long line '.repeat(200);
    await open('text',text,'text/plain'); await ready();
    assert.equal(await evaluate(() => document.querySelector('#text').textContent),text);
    assert.equal(await evaluate(() => Boolean(window.injectedFileScript)),false);
    await click('#wrap');
    assert.equal(await evaluate(() => getComputedStyle(document.querySelector('#text')).whiteSpace),'pre');
    await click('#wrap'); assert.equal(await evaluate(() => getComputedStyle(document.querySelector('#text')).whiteSpace),'pre-wrap');
    await click('#copy'); await wait(() => document.querySelector('#copy-status').textContent.length > 0);
    assert.match(await evaluate(() => document.querySelector('#copy-status').textContent),/已复制|手动/);
    await evaluate(() => { Object.defineProperty(navigator,'clipboard',{ configurable:true,value:{writeText:async()=>{throw Error('fixture denied');}} }); });
    await click('#copy'); await wait(() => document.querySelector('#copy-status').textContent.includes('手动'));
    assert.equal(await evaluate(() => document.activeElement.id),'text');
  });
  await check('installed text: GB18030 recovery and failed encoding switch release URL; UTF16 BOM', async () => {
    await open('text',Buffer.from([0xd6,0xd0,0xce,0xc4]),'text/plain'); await failed();
    assert.deepEqual(await evaluate(() => [document.querySelector('#encoding').disabled,document.querySelector('#download').hidden]),[false,true]);
    await select('gb18030'); await ready(); assert.equal(await evaluate(() => document.querySelector('#text').textContent),'中文');
    await trackUrls(); await select('utf-8'); await failed();
    assert.deepEqual(await evaluate(() => [document.querySelector('#download').hidden,window.testRevoked.length]),[true,1]);
    await select('gb18030'); await ready();
    await open('text',Buffer.from([255,254,0x2d,0x4e,0x87,0x65]),'text/plain'); await ready();
    assert.equal(await evaluate(() => document.querySelector('#text').textContent),'中文');
    await screenshot('acceptance-text.png');
  });
  await check('installed failures: invalid query, HTML login, binary text and image decode cleanup', async () => {
    await open('png',Buffer.from(images[0][1],'base64'),'image/png','wrong.txt'); await failed();
    assert.equal(await evaluate(() => document.querySelector('#download').hidden),true);
    await goto(`${base}file-viewer.html?format=text&name=x.txt&source=https://evil.invalid/files/1&original=javascript:alert(1)`); await failed();
    assert.equal(await evaluate(() => document.querySelector('#original').hidden),true);
    for (const [body,type] of [['<html>login</html>','text/html'],[Buffer.from([0,1,2]),'text/plain']]) {
      await open('text',body,type); await failed();
      assert.equal(await evaluate(() => document.querySelector('#copy').disabled),true);
    }
    await open('png',Buffer.from(images[0][1],'base64').subarray(0,33),'image/png'); await failed();
    assert.deepEqual(await evaluate(() => [document.querySelector('#download').hidden,document.querySelector('#rotate').disabled,document.querySelector('#original').hidden]),[true,true,false]);
    await trackUrls(); await click('#retry'); await failed();
    assert.equal(await evaluate(() => window.testRevoked.length),1);
    const huge = Buffer.from(images[0][1],'base64'); huge.writeUInt32BE(20000,16);
    await open('png',huge,'image/png'); await failed();
    assert.match(await evaluate(() => document.querySelector('#status-detail').textContent),/尺寸/);
  });
  await check('installed retry and pagehide revoke URLs and clear visible content', async () => {
    await open('text','lifecycle','text/plain'); await ready(); await trackUrls();
    const first = await evaluate(() => document.querySelector('#download').href);
    await evaluate(() => document.querySelector('#retry').dispatchEvent(new Event('click'))); await ready();
    assert.deepEqual(await evaluate(() => window.testRevoked),[first]);
    const second = await evaluate(() => document.querySelector('#download').href); assert.notEqual(first,second);
    await evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    assert.deepEqual(await evaluate(() => window.testRevoked),[first,second]);
    assert.deepEqual(await evaluate(() => [document.querySelector('#text').hidden,document.querySelector('#text').textContent,document.querySelector('#download').hidden]),[true,'',true]);
  });
  fixtures.delete(source);
}

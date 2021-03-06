suite('End to End', () => {
  let assert = require('assert');
  let {documenter, downloader} = require('../');
  let debug = require('debug')('test');
  let _ = require('lodash');
  let tar = require('tar-stream');
  let rootdir = require('app-root-dir');
  let zlib = require('zlib');
  let validator = require('taskcluster-lib-validate');
  let config = require('typed-env-config');
  let API = require('taskcluster-lib-api');
  let Exchanges = require('pulse-publisher');

  let validate = null;
  let api = null;
  let exchanges = null;
  let references = null;
  let cfg = config({});
  let credentials = cfg.taskcluster.credentials;
  let tier = 'core';

  suiteSetup(async () => {
    validate = await validator({
      folder: './test/schemas',
      baseUrl: 'http://localhost:1203/',
      constants: {'my-constant': 42},
    });
    api = new API({
      title: 'Testing Stuff',
      description: 'This is for testing stuff!',
    });
    exchanges = new Exchanges({
      title: 'Testing Stuff Again',
      description: 'Another test!',
    });
    references = [
      {name: 'api', reference: api.reference({baseUrl: 'http://localhost'})},
      {name: 'events', reference: exchanges.reference({baseUrl: 'http://localhost'})},
    ];
  });

  async function getObjectsInStream(inStream) {
    let output = {};
    let extractor = tar.extract();

    let downloadPromise = new Promise((resolve, reject) => {
      extractor.on('entry', (header, stream, callback) => {
        let data = [];

        stream.on('data', function(chunk) {
          data.push(chunk);
        });

        stream.on('end', () => {
          output[header.name] = data.join('');
          callback(); //ready for next entry
        });

        stream.resume(); //just auto drain the stream
      });

      extractor.on('finish', function() {
        // all entries read
        resolve();
      });

      extractor.on('error', function() {
        reject();
      });
    });
    inStream.pipe(extractor);
    await downloadPromise;
    return output;
  }

  function assertInTarball(shoulds, tarball) {
    shoulds.push('metadata.json');
    shoulds.push('README.md');
    let contains = [];
    let extractor = tar.extract();
    extractor.on('entry', (header, stream, callback) => {
      stream.on('end', () => {
        contains.push(header.name);
        callback(); // ready for next entry
      });
      stream.resume(); // just auto drain the stream
    });

    return new Promise((resolve, reject) => {
      extractor.on('finish', function() {
        try {
          assert.deepEqual(contains.sort(), shoulds.sort());
        } catch (e) {
          reject(e);
        }
        resolve();
      });

      tarball.pipe(zlib.Unzip()).pipe(extractor);
    });
  }

  test('tarball exists', async function() {
    let doc = await documenter({
      schemas: validate.schemas,
      tier,
    });
    assert.ok(doc.tgz);
  });

  test('tarball is empty but exists', function() {
    let doc = documenter({
      tier,
    });
    assert.equal(doc.tgz, null);
  });

  test('test publish tarball', async function() {
    if (!credentials.clientId) {
      this.skip();
    }
    let doc = await documenter({
      project: 'docs-testing',
      schemas: validate.schemas,
      tier,
      credentials,
      docsFolder: './test/docs/',
      references,
      bucket: cfg.bucket,
      publish: true,
    });
    assert.ok(doc.tgz);
  });

  test('tarball contains docs and metadata', async function() {
    let doc = await documenter({
      docsFolder: './test/docs',
      tier,
    });
    let shoulds = [
      'docs/example.md',
      'docs/nested/nested-example.md',
    ];
    return assertInTarball(shoulds, doc.tgz);
  });

  test('tarball contains schemas and metadata', async function() {
    let doc = await documenter({
      schemas: validate.schemas,
      tier,
    });
    let shoulds = [
      'schemas/foo.json',
      'schemas/bar.json',
      'docs/documenting-non-services.md',
      'docs/format.md',
    ];
    return assertInTarball(shoulds, doc.tgz);
  });

  test('tarball contains references and metadata', async function() {
    let doc = await documenter({
      references,
      tier,
    });
    let shoulds = [
      'references/api.json',
      'references/events.json',
      'docs/documenting-non-services.md',
      'docs/format.md',
    ];
    return assertInTarball(shoulds, doc.tgz);
  });

  test('tarball contains only metadata', async function() {
    let doc = await documenter({
      tier,
    });
    let shoulds = [
      'docs/documenting-non-services.md',
      'docs/format.md',
    ];
    return assertInTarball(shoulds, doc.tgz);
  });

  test('download tarball contains project', async function() {
    if (!credentials.clientId) {
      this.skip();
    }

    let stream = await downloader({
      project: 'docs-testing',
      bucket: cfg.bucket,
      credentials,
    });

    let files = await getObjectsInStream(stream);

    let shoulds = [
      'metadata.json',
    ];

    for (let should of shoulds) {
      assert.ok(files[should]);
    }
  });
});

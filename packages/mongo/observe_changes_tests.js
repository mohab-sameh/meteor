var makeCollection = function () {
  if (Meteor.isServer) {
    return new Mongo.Collection(Random.id());
  } else {
    return new Mongo.Collection(null);
  }
};

_.each ([{added: 'added', forceOrdered: true},
  {added: 'added', forceOrdered: false},
  {added: 'addedBefore', forceOrdered: false}], function (options) {
  var added = options.added;
  var forceOrdered = options.forceOrdered;

  Tinytest.addAsync(
    'observeChanges - single id - basics ' +
      added +
      (forceOrdered ? ' force ordered' : ''),
    async function(test, onComplete) {
      var c = makeCollection();
      var counter = 0;
      var callbacks = [added, 'changed', 'removed'];
      if (forceOrdered) callbacks.push('movedBefore');
      await withCallbackLogger(test, callbacks, Meteor.isServer, async function(logger) {
        var barid = await c.insertAsync({ thing: 'stuff' });
        var fooid = await c.insertAsync({ noodles: 'good', bacon: 'bad', apples: 'ok' });

        var handle = await c.find(fooid).observeChanges(logger);
        if (added === 'added') {
          await logger.expectResult(added, [
            fooid,
            { noodles: 'good', bacon: 'bad', apples: 'ok' },
          ]);
        } else {
          await logger.expectResult(added, [
            fooid,
            { noodles: 'good', bacon: 'bad', apples: 'ok' },
            null,
          ]);
        }
        await c.updateAsync(fooid, {
          noodles: 'alright',
          potatoes: 'tasty',
          apples: 'ok',
        });
        await logger.expectResult('changed', [
          fooid,
          { noodles: 'alright', potatoes: 'tasty', bacon: undefined },
        ]);

        await c.removeAsync(fooid);
        await logger.expectResult('removed', [fooid]);

        await logger.expectNoResult(async () => {
          await c.removeAsync(barid);
          await c.insertAsync({ noodles: 'good', bacon: 'bad', apples: 'ok' });
        });

        handle.stop();

        const badCursor = c.find({}, { fields: { noodles: 1, _id: false } });
        await test.throwsAsync(async function() {
          await badCursor.observeChanges(logger);
        });

        onComplete();
      });
    }
  );
});

Tinytest.addAsync('observeChanges - callback isolation', async function(
  test,
  onComplete
) {
  var c = makeCollection();
  await withCallbackLogger(
    test,
    ['added', 'changed', 'removed'],
    Meteor.isServer,
    async function(logger) {
      var handles = [];
      var cursor = c.find();
      handles.push(await cursor.observeChanges(logger));
      // fields-tampering observer
      handles.push(
        await cursor.observeChanges({
          added: function(id, fields) {
            fields.apples = 'green';
          },
          changed: function(id, fields) {
            fields.apples = 'green';
          },
        })
      );

      var fooid = await c.insertAsync({ apples: 'ok' });
      await logger.expectResult('added', [fooid, { apples: 'ok' }]);

      await c.updateAsync(fooid, { apples: 'not ok' });

      await logger.expectResult('changed', [fooid, { apples: 'not ok' }]);

      test.equal((await c.findOneAsync(fooid)).apples, 'not ok');

      for (const handle of handles) {
        await handle.stop();
      }
      onComplete();
    }
  );
});

Tinytest.addAsync('observeChanges - single id - initial adds', async function(
  test,
  onComplete
) {
  var c = makeCollection();
  await withCallbackLogger(
    test,
    ['added', 'changed', 'removed'],
    Meteor.isServer,
    async function(logger) {
      var fooid = await c.insertAsync({ noodles: 'good', bacon: 'bad', apples: 'ok' });
      var handle = await c.find(fooid).observeChanges(logger);
      await logger.expectResult('added', [
        fooid,
        { noodles: 'good', bacon: 'bad', apples: 'ok' },
      ]);
      await logger.expectNoResult();
      handle.stop();
      onComplete();
    }
  );
});



Tinytest.addAsync("observeChanges - unordered - initial adds", function (test, onComplete) {
  var c = makeCollection();
  withCallbackLogger(test, ["added", "changed", "removed"], Meteor.isServer, function (logger) {
    var fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok"});
    var barid = c.insert({noodles: "good", bacon: "weird", apples: "ok"});
    var handle = c.find().observeChanges(logger);
    logger.expectResultUnordered([
      {callback: "added",
        args: [fooid, {noodles: "good", bacon: "bad", apples: "ok"}]},
      {callback: "added",
        args: [barid, {noodles: "good", bacon: "weird", apples: "ok"}]}
    ]);
    logger.expectNoResult();
    handle.stop();
    onComplete();
  });
});

Tinytest.addAsync("observeChanges - unordered - basics", function (test, onComplete) {
  var c = makeCollection();
  withCallbackLogger(test, ["added", "changed", "removed"], Meteor.isServer, function (logger) {
    var handle = c.find().observeChanges(logger);
    var barid = c.insert({thing: "stuff"});
    logger.expectResultOnly("added", [barid, {thing: "stuff"}]);

    var fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok"});

    logger.expectResultOnly("added", [fooid, {noodles: "good", bacon: "bad", apples: "ok"}]);

    c.update(fooid, {noodles: "alright", potatoes: "tasty", apples: "ok"});
    c.update(fooid, {noodles: "alright", potatoes: "tasty", apples: "ok"});
    logger.expectResultOnly("changed",
      [fooid, {noodles: "alright", potatoes: "tasty", bacon: undefined}]);
    c.remove(fooid);
    logger.expectResultOnly("removed", [fooid]);
    c.remove(barid);
    logger.expectResultOnly("removed", [barid]);

    fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok"});

    logger.expectResult("added", [fooid, {noodles: "good", bacon: "bad", apples: "ok"}]);
    logger.expectNoResult();
    handle.stop();
    onComplete();
  });
});

if (Meteor.isServer) {
  Tinytest.addAsync("observeChanges - unordered - specific fields", function (test, onComplete) {
    var c = makeCollection();
    withCallbackLogger(test, ["added", "changed", "removed"], Meteor.isServer, function (logger) {
      var handle = c.find({}, {fields:{noodles: 1, bacon: 1}}).observeChanges(logger);
      var barid = c.insert({thing: "stuff"});
      logger.expectResultOnly("added", [barid, {}]);

      var fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok"});

      logger.expectResultOnly("added", [fooid, {noodles: "good", bacon: "bad"}]);

      c.update(fooid, {noodles: "alright", potatoes: "tasty", apples: "ok"});
      logger.expectResultOnly("changed",
        [fooid, {noodles: "alright", bacon: undefined}]);
      c.update(fooid, {noodles: "alright", potatoes: "meh", apples: "ok"});
      c.remove(fooid);
      logger.expectResultOnly("removed", [fooid]);
      c.remove(barid);
      logger.expectResultOnly("removed", [barid]);

      fooid = c.insert({noodles: "good", bacon: "bad"});

      logger.expectResult("added", [fooid, {noodles: "good", bacon: "bad"}]);
      logger.expectNoResult();
      handle.stop();
      onComplete();
    });
  });

  Tinytest.addAsync("observeChanges - unordered - specific fields + selector on excluded fields", function (test, onComplete) {
    var c = makeCollection();
    withCallbackLogger(test, ["added", "changed", "removed"], Meteor.isServer, function (logger) {
      var handle = c.find({ mac: 1, cheese: 2 },
        {fields:{noodles: 1, bacon: 1, eggs: 1}}).observeChanges(logger);
      var barid = c.insert({thing: "stuff", mac: 1, cheese: 2});
      logger.expectResultOnly("added", [barid, {}]);

      var fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok", mac: 1, cheese: 2});

      logger.expectResultOnly("added", [fooid, {noodles: "good", bacon: "bad"}]);

      c.update(fooid, {noodles: "alright", potatoes: "tasty", apples: "ok", mac: 1, cheese: 2});
      logger.expectResultOnly("changed",
        [fooid, {noodles: "alright", bacon: undefined}]);

      // Doesn't get update event, since modifies only hidden fields
      logger.expectNoResult(() => {
        c.update(fooid, {
          noodles: "alright",
          potatoes: "meh",
          apples: "ok",
          mac: 1,
          cheese: 2
        });
      });

      c.remove(fooid);
      logger.expectResultOnly("removed", [fooid]);
      c.remove(barid);
      logger.expectResultOnly("removed", [barid]);

      fooid = c.insert({noodles: "good", bacon: "bad", mac: 1, cheese: 2});

      logger.expectResult("added", [fooid, {noodles: "good", bacon: "bad"}]);
      logger.expectNoResult();
      handle.stop();
      onComplete();
    });
  });
}

Tinytest.addAsync("observeChanges - unordered - specific fields + modify on excluded fields", function (test, onComplete) {
  var c = makeCollection();
  withCallbackLogger(test, ["added", "changed", "removed"], Meteor.isServer, function (logger) {
    var handle = c.find({ mac: 1, cheese: 2 },
      {fields:{noodles: 1, bacon: 1, eggs: 1}}).observeChanges(logger);
    var fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok", mac: 1, cheese: 2});

    logger.expectResultOnly("added", [fooid, {noodles: "good", bacon: "bad"}]);


    // Noodles go into shadow, mac appears as eggs
    c.update(fooid, {$rename: { noodles: 'shadow', apples: 'eggs' }});
    logger.expectResultOnly("changed",
      [fooid, {eggs:"ok", noodles: undefined}]);

    c.remove(fooid);
    logger.expectResultOnly("removed", [fooid]);
    logger.expectNoResult();
    handle.stop();
    onComplete();
  });
});

Tinytest.addAsync(
  "observeChanges - unordered - unset parent of observed field",
  function (test, onComplete) {
    var c = makeCollection();
    withCallbackLogger(
      test, ['added', 'changed', 'removed'], Meteor.isServer,
      function (logger) {
        var handle = c.find({}, {fields: {'type.name': 1}}).observeChanges(logger);
        var id = c.insert({ type: { name: 'foobar' } });
        logger.expectResultOnly('added', [id, { type: { name: 'foobar' } }]);

        c.update(id, { $unset: { type: 1 } });
        test.equal(c.find().fetch(), [{ _id: id }]);
        logger.expectResultOnly('changed', [id, { type: undefined }]);

        handle.stop();
        onComplete();
      }
    );
  }
);



Tinytest.addAsync("observeChanges - unordered - enters and exits result set through change", function (test, onComplete) {
  var c = makeCollection();
  withCallbackLogger(test, ["added", "changed", "removed"], Meteor.isServer, function (logger) {
    var handle = c.find({noodles: "good"}).observeChanges(logger);
    var barid = c.insert({thing: "stuff"});

    var fooid = c.insert({noodles: "good", bacon: "bad", apples: "ok"});
    logger.expectResultOnly("added", [fooid, {noodles: "good", bacon: "bad", apples: "ok"}]);

    c.update(fooid, {noodles: "alright", potatoes: "tasty", apples: "ok"});
    logger.expectResultOnly("removed",
      [fooid]);
    c.remove(fooid);
    c.remove(barid);

    fooid = c.insert({noodles: "ok", bacon: "bad", apples: "ok"});
    c.update(fooid, {noodles: "good", potatoes: "tasty", apples: "ok"});
    logger.expectResult("added", [fooid, {noodles: "good", potatoes: "tasty", apples: "ok"}]);
    logger.expectNoResult();
    handle.stop();
    onComplete();
  });
});


const getPromiseAndResolver = () => {
  let resolver;
  const promise = new Promise(r => (resolver = r));
  return [resolver, promise];
};

if (Meteor.isServer) {
  testAsyncMulti("observeChanges - tailable", [
    async function (test, expect) {
      var self = this;
      var collName = 'cap_' + Random.id();
      var coll = new Mongo.Collection(collName);
      await coll.createCappedCollectionAsync(1000000);
      self.xs = [];
      self.expects = [];
      self.insert = async function(fields) {
        coll.insertAsync(
          _.extend({ ts: new MongoInternals.MongoTimestamp(0, 0) }, fields)
        );
      };

      // Tailable observe shouldn't show things that are in the initial
      // contents.
      self.insert({ x: 1 });
      // Wait for one added call before going to the next test function.

      const [resolver, promise] = getPromiseAndResolver();

      self.expects.push(resolver);

      var cursor = coll.find({ y: { $ne: 7 } }, { tailable: true });
      self.handle = await cursor.observeChanges({
        added: function(id, fields) {
          self.xs.push(fields.x);
          test.notEqual(self.expects.length, 0);
          self.expects.pop()();
        },
        changed: function() {
          test.fail({ unexpected: 'changed' });
        },
        removed: function() {
          test.fail({ unexpected: 'removed' });
        },
      });

      // Nothing happens synchronously.
      test.equal(self.xs, []);
      await promise;
    },
    async function (test) {
      var self = this;
      // The cursors sees the first element.
      test.equal(self.xs, [1]);
      self.xs = [];

      const [resolver1, promise1] = getPromiseAndResolver();
      const [resolver2, promise2] = getPromiseAndResolver();

      self.insert({x: 2, y: 3});
      self.insert({x: 3, y: 7});  // filtered out by the query
      self.insert({x: 4});
      // Expect two added calls to happen.
      self.expects = [resolver1, resolver2];
      await Promise.all([promise1, promise2]);
    },
    function (test, expect) {
      var self = this;
      test.equal(self.xs, [2, 4]);
      self.xs = [];
      self.handle.stop();

      self.insert({x: 5});
      // XXX This timeout isn't perfect but it's pretty hard to prove that an
      // event WON'T happen without something like a write fence.
      Meteor.setTimeout(expect(), 1000);
    },
    function (test, expect) {
      var self = this;
      test.equal(self.xs, []);
    }
  ]);
}


testAsyncMulti("observeChanges - bad query", [
  async function (test, expect) {
    var c = makeCollection();
    var observeThrows = async function () {
      await test.throwsAsync(async function () {
        await c.find({__id: {$in: null}}).observeChanges({
          added: function () {
            test.fail("added shouldn't be called");
          }
        });
      }, '$in needs an array');
    };

    if (Meteor.isClient) {
      await observeThrows();
      return;
    }

    const p1 = new Promise(r => {
      observeThrows().finally(() => r());
    });
    const p2 = new Promise(r => {
      observeThrows().finally(() => r());
    });

    await p1;
    await p2;
  }
]);

if (Meteor.isServer) {
  Tinytest.addAsync(
    'observeChanges - EnvironmentVariable',
    async function(test) {
      var c = makeCollection();

      let callOnFinish;
      const promise = new Promise(r => callOnFinish = r);

      var environmentVariable = new Meteor.EnvironmentVariable();
      await environmentVariable.withValue(true, async function() {
        var handle = await c
          .find({}, { fields: { 'type.name': 1 } })
          .observeChanges({
            added: function() {
              test.isTrue(environmentVariable.get());
              handle.stop();
              callOnFinish();
            },
          });
      });
     await c.insertAsync({ type: { name: 'foobar' } });
     return promise;
    }
  );
}

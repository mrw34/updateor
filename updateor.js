if (Meteor.isServer) {
  const Notifications = new Mongo.Collection('notifications');
  var latestVersions;
  Meteor.users.allow({
    remove: (userId, doc) => doc._id === userId
  });
  Meteor.startup(() => {
    updateLatestVersions();
    Meteor.users.find({createdAt: {$gt: new Date()}}).observeChanges({
      added: (id, user) => {
        checkUser(user);
      }
    });
    Meteor.setInterval(() => {
      if (new Date().toISOString().indexOf('T02:00') === -1) return;
      updateLatestVersions();
      Meteor.users.find().forEach(checkUser);
    }, 60 * 1000);
  });
  function updateLatestVersions() {
    latestVersions = HTTP.get('https://atmospherejs.com/a/packages', {
      headers: { Accept: 'application/json'}
    }).data.filter(pkg => pkg.latestVersion).reduce((memo, pkg) => {
      memo[pkg.name] = pkg.latestVersion.version;
      return memo;
    }, {});
  }
  function checkUser(user) {
    const github = user.services.github;
    const headers = {
      Authorization: `token ${github.accessToken}`,
      'User-Agent': Meteor.settings.user_agent
    };
    const url = `https://api.github.com/users/${github.username}/repos`;
    const repos = HTTP.get(url, { headers: headers })
    .data.reduce((memo, repo) => {
      try {
        memo[repo.name] = {
          packages: HTTP.get(
            repo.contents_url.replace('{+path}', '.meteor/packages'), {
              headers: _.extend({
                Accept: 'application/vnd.github.v3.raw'
              }, headers)
            }).content,
          versions: HTTP.get(
            repo.contents_url.replace('{+path}', '.meteor/versions'), {
              headers: _.extend({
                Accept: 'application/vnd.github.v3.raw'
              }, headers)
            }).content
        }
      } finally {
        return memo;
      }
    }, {});
    _.each(repos, (repo, name) => {
      const versions = repo.versions.trim().split('\n').reduce((memo, line) =>
        _.extend(_.object([line.split('@')]), memo), {});
      const packages = repo.packages.trim().split('\n').filter(line =>
        line && line.indexOf('#') !== 0 && line.indexOf(':') !== -1);
      const packageVersions = packages.filter(pkg =>
        versions[pkg] !== latestVersions[pkg]).reduce((memo, pkg) => {
        const notification = {
          username: github.username,
          repo: name,
          package: pkg,
          version: latestVersions[pkg]
        };
        if (!Notifications.findOne(notification)) {
          memo[pkg] = {
            current: versions[pkg],
            available: latestVersions[pkg]
          };
          Notifications.insert(notification);
        }
        return memo;
      }, {});
      if (_.isEmpty(packageVersions)) return;
      Email.send({
        from: Meteor.settings.email_from,
        to: github.email,
        subject: `Package updates for ${name}`,
        text: ['The following updates are available:', '']
          .concat(_.map(packageVersions, (pkg, name) =>
            `${name} ${pkg.available} (previously ${pkg.current})`))
          .concat(['', 'Run the following to install them:', '',
            `meteor update ${Object.keys(packageVersions).join(' ')}`, '',
            'Visit the site to unsubscribe:', '',
            'http://updateor.meteor.com']).join('\n')
      });
    });
  }
} else {
  Template.body.events({
    'click button': () => {
      Meteor.users.remove(Meteor.userId());
    }
  });
}

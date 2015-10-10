if (Meteor.isServer) {
  var Notifications = new Mongo.Collection('notifications');
  var latestVersions;
  Meteor.users.allow({
    remove: (userId, doc) => doc._id === userId
  });
  Meteor.startup(() => {
    updateLatestVersions();
    Meteor.users.find().observeChanges({
      added: (id, user) => {
        checkUser(user);
      }
    });
    Meteor.setInterval(() => {
      if (new Date().toISOString().indexOf('T02:00') !== -1) {
        updateLatestVersions();
        Meteor.users.find().forEach(checkUser);
      }
    }, 60 * 1000);
  });
  function updateLatestVersions() {
    latestVersions = HTTP.get('https://atmospherejs.com/a/packages', {headers: {Accept: 'application/json'}}).data.filter(pkg => pkg.latestVersion).reduce((memo, pkg) => {
      memo[pkg.name] = pkg.latestVersion.version;
      return memo;
    }, {});
  }
  function checkUser(user) {
    const github = user.services.github;
    const headers = {
      Authorization: `token ${github.accessToken}`,
      'User-Agent': 'mrw34/updateor'
    };
    var repos = HTTP.get(`https://api.github.com/users/${github.username}/repos`, {headers: headers}).data.reduce((memo, repo) => {
      try {
        memo[repo.name] = {
          packages: HTTP.get(repo.contents_url.replace('{+path}', '.meteor/packages'), {headers: _.extend({Accept: 'application/vnd.github.v3.raw'}, headers)}).content,
          versions: HTTP.get(repo.contents_url.replace('{+path}', '.meteor/versions'), {headers: _.extend({Accept: 'application/vnd.github.v3.raw'}, headers)}).content
        }
      } finally {
        return memo;
      }
    }, {});
    _.each(repos, (repo, name) => {
      var versions = repo.versions.split('\n').reduce((memo, line) => _.extend(_.object([line.split('@')]), memo), {});
      var packages = repo.packages.split('\n').filter(line => line && line.indexOf('#') !== 0 && line.indexOf(':') !== -1);
      var packageVersions = packages.reduce((memo, name) => {
        if (versions[name] !== latestVersions[name]) {
          const notification = {
            username: github.username,
            package: name,
            version: latestVersions[name]
          };
          if (!Notifications.findOne(notification)) {
            memo[name] = {
              current: versions[name],
              available: latestVersions[name]
            };
            Notifications.insert(notification);
          }
        }
        return memo;
      }, {});
      if (!_.isEmpty(packageVersions)) {
        Email.send({
          from: 'Updateor <mark.woodbridge+updateor@gmail.com>',
          to: github.email,
          subject: `Package updates for ${name}`,
          text: ['The following updates are available:', ''].concat(_.map(packageVersions, (pkg, name) => `${name} ${pkg.available} (previously ${pkg.current})`)).concat(['', 'Run the following to install them:', '', `meteor update ${Object.keys(packageVersions).join(' ')}`, '', 'Visit the site to unsubscribe:', '', 'http://updateor.meteor.com']).join('\n')
        });
      }
    });
  }
} else {
  Template.body.events({
    'click button': () => {
      Meteor.users.remove(Meteor.userId());
    }
  });
}

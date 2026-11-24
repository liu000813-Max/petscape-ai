const { openOfficialPosts } = require('../../utils/navigation');

Page({
  onLoad() { this.openOfficial(); },
  openOfficial() { openOfficialPosts(); },
});

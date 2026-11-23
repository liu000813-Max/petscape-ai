// Display names can evolve independently of the existing API topic values.
const POST_TOPICS = ['求助', '晒栖境', '经验', '同城服务'];
function topicLabel(value) { return value === '晒栖境' ? '晒宠境' : value; }
module.exports = { POST_TOPICS, topicLabel };

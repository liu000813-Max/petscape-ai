function slideDistance(from, to, count) {
  const distance = to - from;
  return count > 2 && Math.abs(distance) > count / 2 ? distance - Math.sign(distance) * count : distance;
}

function animatePetTrack(page, distance) {
  const { petPreviewMargin, petSlideDuration } = page.data;
  const startedAt = Date.now();
  page.setData({ petSliding: true });
  const frame = () => {
    const progress = Math.min(1, (Date.now() - startedAt) / petSlideDuration);
    if (progress === 1) return page.finishPetSlide();
    const eased = progress * progress * (3 - 2 * progress);
    const span = `${(100 * eased).toFixed(2)}%`;
    const margins = `${(2 * petPreviewMargin * eased).toFixed(2)}rpx`;
    // One slide spans the viewport minus both preview margins.
    const shift = distance > 0 ? `${margins} - ${span}` : `${span} - ${margins}`;
    page.setData({ petSlideTransform: `transform:translateX(calc(${shift}))` });
    page.petSlideTimer = setTimeout(frame, 16);
  };
  page.petSlideTimer = setTimeout(frame, 16);
}

module.exports = { slideDistance, animatePetTrack };

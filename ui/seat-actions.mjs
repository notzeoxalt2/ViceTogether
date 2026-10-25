export function localSeatAction(isHost, seat, previousCarId) {
  if (!Number.isSafeInteger(seat?.id) || !Number.isInteger(seat?.seat)) return null;
  if (seat.id < 0) return previousCarId >= 0 ? { release: true } : null;
  if (!isHost) return null;
  return seat.seat === -1 ? { driver: true, car: seat } : { id: seat.id };
}

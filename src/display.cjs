const {screen}=require('electron');
function secondary() {
  const primary=screen.getPrimaryDisplay();
  return screen.getAllDisplays().find(d=>d.id!==primary.id)||primary;
}
function gameWindow(index=0) {
  const display=secondary(),area=screen.dipToScreenRect(null,display.workArea);
  const width=Math.max(640,Math.min(960,Math.floor(area.width/2)-24));
  const height=Math.max(480,Math.min(540,Math.floor(width*9/16)));
  return {x:index?area.x+area.width-width-16:area.x+8,y:area.y+8,width,height,displayId:display.id,area,secondary:display.id!==screen.getPrimaryDisplay().id};
}
module.exports={secondary,gameWindow};

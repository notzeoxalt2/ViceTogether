class LaunchGate {
  async run(operation) {
    if(this.busy)throw new Error('Your game is already starting. Please wait.');
    this.busy=true;
    try{return await operation();}finally{this.busy=false;}
  }
}
module.exports={LaunchGate};

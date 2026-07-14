process.stdin.resume();
process.stdin.once("end", () => {
  process.stdout.write('{"protocolVersion":1,"type":"result","ok":true,"message":"first"}\n');
  process.stdout.write('{"protocolVersion":1,"type":"result","ok":true,"message":"second"}\n');
});

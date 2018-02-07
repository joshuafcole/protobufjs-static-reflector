import * as pbjs from "protobufjs";

//----------------------------------------------------------------------
// Messages
//----------------------------------------------------------------------

export interface Message<T extends object> {
  toJSON():T;
}

export interface MessageType<T extends object> {
  name:string;
  new(properties?:T):Message<T>;
  create(properties?:T):Message<T>;
  encode(message:T, writer?:pbjs.Writer):pbjs.Writer;
  encodeDelimited(message:T, writer?:pbjs.Writer):pbjs.Writer;
  decode(reader:pbjs.Reader|Uint8Array, length?:number):Message<T>;
  decodeDelimited(reader:pbjs.Reader|Uint8Array):Message<T>;
  verify(message:object):string|null;
  fromObject(obj:object):T;
  toObject(message:Message<T>, options?:pbjs.IConversionOptions):T;
}

export type ReflectedMessageType<T extends object> = MessageType<T>&{
  _reflected:true;
  name:string;
  ns:string;
  fields:{[name:string]:pbjs.Field};
  fieldsArray:pbjs.Field[];
};

export function reflectMessage<T extends object>(messageType:MessageType<T>, root = pbjs.roots.default):ReflectedMessageType<T> {
  let reflected:ReflectedMessageType<T> = messageType as any;
  if(reflected._reflected) return reflected;
  reflected.ns = findNS(messageType, root);
  reflected.fieldsArray = reflectMessageTypeFields(messageType);
  reflected.fields = reflected.fieldsArray.reduce((fields, field) => {
    fields[field.name] = field;
    return fields;
  }, {});
  return reflected;
}

let reflectMessageTypeFieldsPattern = /^\s*message\.(.*?)\s*=\s*\$root\.(.*)\.fromObject.*$/gmi;
export function reflectMessageTypeFields<T extends object>(messageType:MessageType<T>) {
  let fields:pbjs.Field[] = [];
  for(let match of scrapeSource(messageType.fromObject, reflectMessageTypeFieldsPattern)) {
    let [_, name, path] = match;
    let field = new pbjs.Field(name, fields.length, path);
    fields.push(field);
  }

  return fields;
}

//----------------------------------------------------------------------
// Services
//----------------------------------------------------------------------

export type ReflectedRPCImpl = (
  this: ReflectedService,
  method: (pbjs.Method|pbjs.rpc.ServiceMethod<pbjs.Message<{}>, pbjs.Message<{}>>),
  requestData: Uint8Array,
  callback: pbjs.RPCImplCallback) => void;

export type ReflectedService<T = pbjs.rpc.Service> = T&{
  _reflected:true;
  name:string;
  ns:string;
  methods:{[name:string]:pbjs.Method};
  methodsArray:pbjs.Method[];
};

export function reflectService<T extends pbjs.rpc.Service>(service:T, root = pbjs.roots.default):ReflectedService<T> {
  let reflected = service as ReflectedService<T>;
  if(reflected._reflected) return reflected;
  reflected.name = (service as any).__proto__.constructor.name;
  reflected.ns = findNS(service, root);
  reflected.methodsArray = reflectServiceMethods(service);
  reflected.methods = reflected.methodsArray.reduce((methods, method) => {
    methods[method.name] = method;
    return methods;
  }, {});
  return reflected;
}

let reflectServiceMethodsPattern = /^\s*return\s*this\.rpcCall\((.*?),\s*\$root\.(.*?),\s*\$root\.(.*?),.*$/gmi;
export function reflectServiceMethods(service:pbjs.rpc.Service) {
  let methods:pbjs.Method[] = [];

  for(let methodName of Object.keys((service as any).__proto__)) {
    if(methodName === "constructor") continue;
    for(let match of scrapeSource(service[methodName], reflectServiceMethodsPattern)) {
      let [_, __, reqPath, resPath] = match;

      let methodType = "rpc"; // @FIXME: The only kind the pattern matches atm.
      let method = new pbjs.Method(methodName, methodType, reqPath, resPath);
      methods.push(method);
    }
  }

  return methods;
}

//----------------------------------------------------------------------
// General
//----------------------------------------------------------------------

export type Reflectable = pbjs.rpc.Service|pbjs.Message<any>|MessageType<any>;
export function findNS(reflectable:Reflectable, root = pbjs.roots.default, path = "") {
  for(let key in root) {
    if(root[key] === reflectable.constructor) return path; // Service & Message
    else if(root[key] === reflectable) return path; // MessageType
    else if(root[key].constructor === Object) {
      let res = findNS(reflectable, root[key], path ? path  + "." + key : key);
      if(res) return res;
    }
  }
  return "";
}

function scrapeSource(func:Function, pattern:RegExp) {
  let source = func.toString();
  let matches:RegExpExecArray[] = [];
  let match:RegExpExecArray|null;
  while((match = pattern.exec(source)) !== null) matches.push(match);
  return matches;
}

export function resolve(path:string, root:pbjs.Root) {
  let cur:any = root;
  for(let part of path.split(".")) {
    if(!cur) break;
    cur = cur[part];
  }
  return cur;
}

export function resolveMessage(path:string, root:pbjs.Root) {
  let resolved = resolve(path, root);
  if(!resolved) return;
  if(!resolved.fromObject) throw new Error(`PBJS type at path is not a message: '${path}'.`);
  return resolved as MessageType<any>;
}

export function resolveService(path:string, root:pbjs.Root) {
  let resolved = resolve(path, root);
  if(!resolved) return;
  if(!(resolved instanceof pbjs.rpc.Service)) throw new Error(`PBJS type at path is not a service: '${path}'.`);
  return resolved;
}

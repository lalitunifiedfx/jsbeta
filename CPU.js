var fs = require('fs');

const XP              = 30;
const PC_SUPERVISOR   = 0x80000000;
const ISR_RESET       = (PC_SUPERVISOR | 0x00000000);
const ISR_ILLOP       = (PC_SUPERVISOR | 0x00000004);
const ISR_CLK         = (PC_SUPERVISOR | 0x00000008);
const ISR_KBD         = (PC_SUPERVISOR | 0x0000000C);
const ISR_MOUSE       = (PC_SUPERVISOR | 0x00000010);

const CALL_HALT       = 0x00;
const CALL_RDCHR      = 0x01;
const CALL_WRCHR      = 0x02;

function debug() {
    // console.log.apply(console, arguments);
}

function sext16_32(v){
    return (v << 16) >> 16;
}

function add32(a, b) {
    return (a + b) & 0xFFFFFFFF;
}

function sub32(a, b) {
    return (a - b) & 0xFFFFFFFF;
}

function mul32(a, b) {
    var l = (a & 0xffff) * b;
    var h = ((a >>> 16) * b) << 16;
    return (l + h) & 0xFFFFFFFF;
}

function div32(a, b) {
    return b == 0 ? 0 : (a / b) & 0xFFFFFFFF;
}

function cmpeq(a, b) {
    return a == b ? 1 : 0;
}

function cmplt(a, b) {
    return a < b ? 1 : 0;
}

function cmple(a, b) {
    return a <= b ? 1 : 0;
}

function and32(a, b) {
    return a&b;
}

function or32(a, b) {
    return a|b;
}

function xor32(a, b) {
    return a^b;
}

function shl32(a, b) {
    return a << (b & 0x1F);
}

function sra32(a, b) {
    return a >> (b & 0x1F);
}

function shr32(a, b) {
    return a >>> b;
}

function invalid(op) {
    CPU.regs[XP] = CPU.PC;
    CPU.PC = ISR_ILLOP;
}

function callout(op) {
    if (CPU.PC & PC_SUPERVISOR) {
        switch (op.imm) {
        case CALL_HALT:
            debug("CPU halted.");
            CPU.halt = true;
            break;
        case CALL_WRCHR:
            process.stdout.write(String.fromCharCode(CPU.regs[op.ra]));
            break;
        }
    }
}

function op_ld(op) {
    CPU.regs[op.rc] = MMU.read(CPU.regs[op.ra] + op.imm);
}

function op_st(op) {
    MMU.write(CPU.regs[op.ra] + op.imm, CPU.regs[op.rc]);
}

function op_jmp(op) {
    var save_pc = CPU.PC;
    CPU.jmp(CPU.regs[op.ra]);
    CPU.regs[op.rc] = save_pc;
}

function op_bf(op) {
    var save_pc = CPU.PC;
    if (CPU.regs[op.ra] == 0)
        CPU.jmp(CPU.PC + (op.imm << 2));
    CPU.regs[op.rc] = save_pc;
}

function op_bt(op) {
    var save_pc = CPU.PC;
    if (CPU.regs[op.ra] != 0)
        CPU.jmp(CPU.PC + (op.imm << 2));
    CPU.regs[op.rc] = save_pc;
}

function op_ldr(op) {
    CPU.regs[op.rc] = MMU.read(CPU.PC + (op.imm << 2));
}

function arith(fn) {
    return function(op) {
        CPU.regs[op.rc] = fn(CPU.regs[op.ra], CPU.regs[op.rb]);
    }
}

function arithc(fn) {
    return function(op) {
        CPU.regs[op.rc] = fn(CPU.regs[op.ra], op.imm);
    }
}

var CPU = {
    /*
     * Registers are maintained as integers in [-2**31, 2**31), and
     * converted appropriately if an unsigned interpretation is needed
     * during execution.
     */
    regs: (function() {
               var x = [];
               for (var i = 0; i < 32; i++) {
                   x[i] = 0;
               }
               return x;
           })(),
    PC: 0,
    halt: false,

    decode: function(op) {
        return {
            opcode: ((op >> 26) & 0x3F),
            ra:     ((op >> 16) & 0x1F),
            rb:     ((op >> 11) & 0x1F),
            rc:     ((op >> 21) & 0x1F),
            imm:    sext16_32(op & 0xFFFF),
        };
    },

    reset: function() {
        var i;
        CPU.PC = ISR_RESET;
        for (i = 0; i < 32; i ++)
            CPU.regs[i] = 0;
        CPU.halt = false;
    },

    step: function() {
        debug("PC:", (CPU.PC & ~PC_SUPERVISOR).toString(16));
        var opcode = MMU.read(CPU.PC);
        var inst = CPU.decode(opcode);
        debug("decode:", inst);
        debug("regs: ", CPU.regs[inst.ra].toString(16), 
                    CPU.regs[inst.rb].toString(16),
                    CPU.regs[inst.rc].toString(16));
        CPU.PC += 4;
        CPU.regs[31] = 0;
        debug("decode: ", CPU.instructions[inst.opcode]);
        CPU.instructions[inst.opcode](inst);
    },

    run: function() {
        while (!CPU.halt)
            CPU.step();
    },

    jmp: function(addr) {
        debug("jump", addr.toString(16));
        CPU.PC = (addr & (0x7FFFFFFC | (CPU.PC & PC_SUPERVISOR)));
    },

    instructions: [
        callout,
        // opcode class 0x00 is invalid except for callout
        invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid,
        // opcode class 0x10: "other"
        // First 8 are reserved
        invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid,
        /* 0x18 */ op_ld,
        /* 0x19 */ op_st,
        /* 0x1A */ invalid,
        /* 0x1B */ op_jmp,
        /* 0x1C */ invalid,
        /* 0x1D */ op_bf,
        /* 0x1E */ op_bt,
        /* 0x1F */ op_ldr,
        // opcode class 0x20: arithmetic
        /* 0x20 */ arith(add32),
        /* 0x21 */ arith(sub32),
        /* 0x22 */ arith(mul32),
        /* 0x23 */ arith(div32),
        /* 0x24 */ arith(cmpeq),
        /* 0x25 */ arith(cmplt),
        /* 0x26 */ arith(cmple),
        /* 0x27 */ invalid,
        /* 0x28 */ arith(and32),
        /* 0x29 */ arith(or32),
        /* 0x2A */ arith(xor32),
        /* 0x2B */ invalid,
        /* 0x2C */ arith(shl32),
        /* 0x2D */ arith(shr32),
        /* 0x2E */ arith(sra32),
        /* 0x2F */ invalid,
        // opcode class 0x30: arithmetic with a constant
        /* 0x30 */ arithc(add32),
        /* 0x31 */ arithc(sub32),
        /* 0x32 */ arithc(mul32),
        /* 0x33 */ arithc(div32),
        /* 0x34 */ arithc(cmpeq),
        /* 0x35 */ arithc(cmplt),
        /* 0x36 */ arithc(cmple),
        /* 0x37 */ invalid,
        /* 0x38 */ arithc(and32),
        /* 0x39 */ arithc(or32),
        /* 0x3A */ arithc(xor32),
        /* 0x3B */ invalid,
        /* 0x3C */ arithc(shl32),
        /* 0x3D */ arithc(shr32),
        /* 0x3E */ arithc(sra32),
        /* 0x3F */ invalid
    ]
};

if (module !== undefined) {
    module.exports = CPU;
    var MMU = require('./MMU.js');
}
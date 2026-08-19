"use strict";
/* ---------------------------------------------------------------
   GLSL grammar for highlight.js. The vendored highlight.min.js only
   bundles the JavaScript grammar (needed by the Block Editor's code
   preview), so the Shader Editor registers this one itself at
   load time via hljs.registerLanguage('glsl', ...).

   Token classes intentionally line up with the `.forge-hljs` theme
   in assets/css/editor.css (hljs-keyword/type/built_in/number/comment/
   meta/string), so GLSL renders with the same palette as every other
   code surface in the editor.
--------------------------------------------------------------- */
(function () {
  if (!window.hljs || typeof window.hljs.registerLanguage !== 'function') return;

  const TYPES = [
    'void', 'bool', 'int', 'uint', 'float', 'double',
    'vec2', 'vec3', 'vec4', 'dvec2', 'dvec3', 'dvec4',
    'bvec2', 'bvec3', 'bvec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4',
    'mat2', 'mat3', 'mat4', 'mat2x2', 'mat2x3', 'mat2x4', 'mat3x2', 'mat3x3', 'mat3x4', 'mat4x2', 'mat4x3', 'mat4x4',
    'sampler1D', 'sampler2D', 'sampler3D', 'samplerCube',
    'sampler1DShadow', 'sampler2DShadow', 'samplerCubeShadow',
    'sampler1DArray', 'sampler2DArray', 'sampler1DArrayShadow', 'sampler2DArrayShadow',
    'isampler1D', 'isampler2D', 'isampler3D', 'isamplerCube', 'usampler1D', 'usampler2D', 'usampler3D', 'usamplerCube',
    'sampler2DRect', 'sampler2DRectShadow', 'samplerBuffer', 'samplerCubeArray',
    'image1D', 'image2D', 'image3D', 'iimage2D', 'uimage2D', 'atomic_uint'
  ];

  const KEYWORDS = [
    'attribute', 'const', 'uniform', 'varying', 'buffer', 'shared', 'coherent', 'volatile', 'restrict', 'readonly', 'writeonly',
    'layout', 'centroid', 'flat', 'smooth', 'noperspective', 'patch', 'sample', 'invariant', 'precise',
    'break', 'continue', 'do', 'for', 'while', 'switch', 'case', 'default', 'if', 'else', 'subroutine',
    'in', 'out', 'inout', 'discard', 'return', 'struct',
    'precision', 'highp', 'mediump', 'lowp', 'common', 'partition', 'active',
    'inline', 'noinline', 'public', 'static', 'extern', 'external', 'interface', 'namespace', 'using'
  ];

  const BUILT_INS = [
    'radians', 'degrees', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh',
    'pow', 'exp', 'log', 'exp2', 'log2', 'sqrt', 'inversesqrt',
    'abs', 'sign', 'floor', 'trunc', 'round', 'roundEven', 'ceil', 'fract', 'mod', 'modf', 'min', 'max', 'clamp', 'mix', 'step', 'smoothstep', 'isnan', 'isinf',
    'floatBitsToInt', 'floatBitsToUint', 'intBitsToFloat', 'uintBitsToFloat',
    'length', 'distance', 'dot', 'cross', 'normalize', 'faceforward', 'reflect', 'refract',
    'matrixCompMult', 'outerProduct', 'transpose', 'determinant', 'inverse',
    'lessThan', 'lessThanEqual', 'greaterThan', 'greaterThanEqual', 'equal', 'notEqual', 'any', 'all', 'not',
    'texture', 'textureProj', 'textureLod', 'textureOffset', 'texelFetch', 'texelFetchOffset',
    'textureGrad', 'textureGather', 'textureSize', 'textureQueryLod', 'textureQueryLevels',
    'texture2D', 'texture2DProj', 'texture2DLod', 'textureCube', 'textureCubeLod', 'texture3D',
    'dFdx', 'dFdy', 'fwidth', 'EmitVertex', 'EndPrimitive', 'barrier', 'memoryBarrier',
    'gl_FragCoord', 'gl_FrontFacing', 'gl_PointCoord', 'gl_Position', 'gl_PointSize',
    'gl_VertexID', 'gl_InstanceID', 'gl_FragDepth', 'gl_ClipDistance'
  ];

  window.hljs.registerLanguage('glsl', hljs => ({
    name: 'GLSL',
    keywords: {
      keyword: KEYWORDS.join(' '),
      type: TYPES.join(' '),
      built_in: BUILT_INS.join(' '),
      literal: 'true false'
    },
    illegal: '"',
    contains: [
      hljs.C_LINE_COMMENT_MODE,
      hljs.C_BLOCK_COMMENT_MODE,
      hljs.C_NUMBER_MODE,
      {
        className: 'meta',
        begin: /#\s*(version|define|undef|if|ifdef|ifndef|else|elif|endif|error|pragma|extension|line)\b/,
        end: /$/,
        keywords: { 'meta-keyword': 'version define undef if ifdef ifndef else elif endif error pragma extension line' },
        contains: [{ begin: /\\\n/, relevance: 0 }]
      }
    ]
  }));
})();

import"./rolldown-runtime-S-ySWqyJ.js";import{d as e,t}from"./vendor-react-DlsJ8uBq.js";e();var n=t(),r={primary:`bg-accent hover:opacity-90 text-white border-accent`,publish:`bg-ok    hover:opacity-90 text-white border-ok`,default:`bg-card  hover:bg-raised  text-muted  border-app`,danger:`bg-card  hover:bg-danger-soft text-danger border-app`,ghost:`bg-transparent hover:bg-raised text-muted border-transparent`};function i({children:e,variant:t=`default`,onClick:i,disabled:a,small:o,icon:s,className:c=``,type:l=`button`}){return(0,n.jsxs)(`button`,{type:l,onClick:i,disabled:a,className:`
        inline-flex items-center gap-1.5 font-semibold border rounded-lg
        transition-all duration-100 whitespace-nowrap cursor-pointer
        disabled:opacity-50 disabled:cursor-not-allowed
        ${o?`text-xs px-2.5 py-1`:`text-sm px-3.5 py-1.5`}
        ${r[t]||r.default}
        ${c}
      `,children:[s&&(0,n.jsx)(`span`,{className:o?`text-xs`:`text-sm`,children:s}),e]})}export{i as t};